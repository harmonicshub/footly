/**
 * LEDGER SERVICE
 * --------------
 * The only code allowed to move money. Nothing else in the codebase
 * writes to ledger_entries.
 *
 * Rules enforced here:
 *   1. Every post is balanced. The DB trigger catches violations, but
 *      we build balanced pairs so it never fires in production.
 *   2. Every post carries an idempotency key. Retries are free.
 *   3. Cash and bonus are separate accounts. Bonus funds can stake but
 *      cannot withdraw — that separation is structural, not a flag.
 */

import type { PoolClient, Pool } from "pg";

export type AccountKind =
  | "user_cash" | "user_bonus" | "user_locked"
  | "house_revenue" | "house_liability" | "psp_settlement" | "promo_expense";

export type EntryReason =
  | "deposit" | "withdrawal" | "withdrawal_reversal"
  | "stake" | "stake_refund" | "winnings" | "cashout"
  | "bonus_grant" | "bonus_convert" | "bonus_expiry"
  | "settlement_rollback" | "manual_adjustment" | "fee";

export interface Posting {
  userId?: string;         // omit for house accounts
  kind: AccountKind;
  amountKobo: number;      // signed; credits positive, debits negative
}

export interface Balance {
  cashKobo: number;
  bonusKobo: number;
  lockedKobo: number;
  /** What the punter can actually stake right now. */
  availableKobo: number;
  /** What the punter can actually withdraw right now. */
  withdrawableKobo: number;
}

export class LedgerService {
  constructor(private pool: Pool) {}

  /**
   * Posts a balanced transaction. Returns the existing transaction ID
   * if this idempotency key has already been used — the caller cannot
   * tell the difference, which is the point.
   */
  async post(args: {
    reason: EntryReason;
    idempotencyKey: string;
    reference?: string;
    note?: string;
    postings: Posting[];
    client?: PoolClient;    // pass to join an outer transaction
  }): Promise<{ transactionId: string; replayed: boolean }> {
    const sum = args.postings.reduce((s, p) => s + p.amountKobo, 0);
    if (sum !== 0) {
      throw new Error(`unbalanced posting: sums to ${sum} kobo`);
    }
    if (args.postings.some((p) => !Number.isInteger(p.amountKobo))) {
      throw new Error("amounts must be whole kobo");
    }

    const own = !args.client;
    const client = args.client ?? (await this.pool.connect());

    try {
      if (own) await client.query("BEGIN");

      const existing = await client.query(
        `SELECT id FROM ledger_transactions WHERE idempotency_key = $1`,
        [args.idempotencyKey]
      );
      if (existing.rowCount) {
        if (own) await client.query("COMMIT");
        return { transactionId: existing.rows[0].id, replayed: true };
      }

      const txn = await client.query(
        `INSERT INTO ledger_transactions (reason, idempotency_key, reference, note)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [args.reason, args.idempotencyKey, args.reference ?? null, args.note ?? null]
      );
      const transactionId = txn.rows[0].id as string;

      for (const p of args.postings) {
        const accountId = await this.accountId(client, p.kind, p.userId);
        await client.query(
          `INSERT INTO ledger_entries (transaction_id, account_id, amount_kobo)
           VALUES ($1, $2, $3)`,
          [transactionId, accountId, p.amountKobo]
        );
      }

      if (own) await client.query("COMMIT");
      return { transactionId, replayed: false };
    } catch (e) {
      if (own) await client.query("ROLLBACK");
      throw e;
    } finally {
      if (own) client.release();
    }
  }

  /**
   * Reads straight from ledger_entries rather than the materialised
   * view. Correctness over speed on the path that gates a bet.
   */
  async balance(userId: string, client?: PoolClient): Promise<Balance> {
    const q = client ?? this.pool;
    const res = await q.query(
      `SELECT a.kind, COALESCE(SUM(e.amount_kobo), 0)::bigint AS bal
         FROM ledger_accounts a
         LEFT JOIN ledger_entries e ON e.account_id = a.id
        WHERE a.user_id = $1
        GROUP BY a.kind`,
      [userId]
    );

    const by: Record<string, number> = {};
    for (const r of res.rows) by[r.kind] = Number(r.bal);

    const cash = by.user_cash ?? 0;
    const bonus = by.user_bonus ?? 0;
    const locked = by.user_locked ?? 0;

    return {
      cashKobo: cash,
      bonusKobo: bonus,
      lockedKobo: locked,
      availableKobo: cash + bonus,
      withdrawableKobo: cash,   // bonus never withdraws
    };
  }

  /** Lazily creates the account row on first use. */
  private async accountId(client: PoolClient, kind: AccountKind, userId?: string) {
    const res = await client.query(
      `INSERT INTO ledger_accounts (user_id, kind, currency)
       VALUES ($1, $2, 'NGN')
       ON CONFLICT (user_id, kind, currency) DO UPDATE SET kind = EXCLUDED.kind
       RETURNING id`,
      [userId ?? null, kind]
    );
    return res.rows[0].id as string;
  }
}

/* ------------------------------------------------------------------ */
/* Standard posting shapes                                             */
/* ------------------------------------------------------------------ */

export const POSTINGS = {
  /** PSP confirmed money in. It sat in psp_settlement until now. */
  deposit: (userId: string, amountKobo: number, feeKobo: number): Posting[] => [
    { userId, kind: "user_cash", amountKobo: amountKobo },
    { kind: "psp_settlement", amountKobo: -(amountKobo + feeKobo) },
    { kind: "house_revenue", amountKobo: feeKobo },
  ],

  /** Stake leaves the spendable balance and sits locked until settlement. */
  stake: (userId: string, cashKobo: number, bonusKobo: number): Posting[] => [
    ...(cashKobo ? [{ userId, kind: "user_cash" as const, amountKobo: -cashKobo }] : []),
    ...(bonusKobo ? [{ userId, kind: "user_bonus" as const, amountKobo: -bonusKobo }] : []),
    { userId, kind: "user_locked", amountKobo: cashKobo + bonusKobo },
  ],

  /** Bet lost: the locked stake becomes house revenue. */
  betLost: (userId: string, stakeKobo: number): Posting[] => [
    { userId, kind: "user_locked", amountKobo: -stakeKobo },
    { kind: "house_revenue", amountKobo: stakeKobo },
  ],

  /** Bet won: release the stake, pay the return from house liability. */
  betWon: (userId: string, stakeKobo: number, payoutKobo: number): Posting[] => [
    { userId, kind: "user_locked", amountKobo: -stakeKobo },
    { userId, kind: "user_cash", amountKobo: payoutKobo },
    { kind: "house_liability", amountKobo: stakeKobo - payoutKobo },
  ],

  /** Bet void: stake returns to cash, untouched. */
  betVoid: (userId: string, stakeKobo: number): Posting[] => [
    { userId, kind: "user_locked", amountKobo: -stakeKobo },
    { userId, kind: "user_cash", amountKobo: stakeKobo },
  ],

  /** Withdrawal requested — funds leave cash immediately so they cannot
   *  be staked while the payout is in flight. */
  withdrawalHold: (userId: string, amountKobo: number): Posting[] => [
    { userId, kind: "user_cash", amountKobo: -amountKobo },
    { kind: "psp_settlement", amountKobo: amountKobo },
  ],

  /** Payout failed or was rejected — put it back. */
  withdrawalReversal: (userId: string, amountKobo: number): Posting[] => [
    { kind: "psp_settlement", amountKobo: -amountKobo },
    { userId, kind: "user_cash", amountKobo: amountKobo },
  ],

  bonusGrant: (userId: string, amountKobo: number): Posting[] => [
    { kind: "promo_expense", amountKobo: -amountKobo },
    { userId, kind: "user_bonus", amountKobo: amountKobo },
  ],

  /** Wagering completed — bonus converts to withdrawable cash. */
  bonusConvert: (userId: string, amountKobo: number): Posting[] => [
    { userId, kind: "user_bonus", amountKobo: -amountKobo },
    { userId, kind: "user_cash", amountKobo: amountKobo },
  ],
};
