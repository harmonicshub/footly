/**
 * WITHDRAWAL SERVICE
 * ------------------
 * Fast withdrawals are the single strongest differentiator a Nigerian
 * book has. Punters forgive worse odds; they do not forgive a payout
 * that sits in "processing" for two days.
 *
 * So the design goal is: auto-approve as much as is safe, and make the
 * exceptions genuinely exceptional. Every rule below that adds friction
 * has to earn its place.
 *
 * Flow: request → hold funds → risk gate → approve (auto or manual)
 *       → queue → transfer → confirm → done.
 * A failure at any step reverses the hold. Money is never in limbo.
 */

import type { Pool, PoolClient } from "pg";
import { LedgerService, POSTINGS } from "./ledger";
import { PspError, type PspName, type PspRouter } from "./psp";

/* ================================================================== */
/* KYC tiers                                                           */
/* ================================================================== */

/**
 * Modelled on CBN's tiered KYC. Tier 1 is phone-only — that is what
 * lets someone sign up and cash out a small win the same evening.
 * Requiring BVN before the first ₦1,000 payout kills retention.
 */
export const KYC_TIERS = {
  tier_0: {
    label: "Unverified",
    requires: [] as string[],
    maxPerWithdrawalKobo: 0,
    maxDailyKobo: 0,
    autoApproveKobo: 0,
  },
  tier_1: {
    label: "Phone verified",
    requires: ["phone"],
    maxPerWithdrawalKobo: 50_000_00,      // ₦50,000
    maxDailyKobo: 50_000_00,
    autoApproveKobo: 20_000_00,           // ₦20,000 goes straight through
  },
  tier_2: {
    label: "BVN verified",
    requires: ["phone", "bvn"],
    maxPerWithdrawalKobo: 500_000_00,
    maxDailyKobo: 1_000_000_00,
    autoApproveKobo: 200_000_00,
  },
  tier_3: {
    label: "Fully verified",
    requires: ["phone", "bvn", "id_document", "address"],
    maxPerWithdrawalKobo: 5_000_000_00,
    maxDailyKobo: 10_000_000_00,
    autoApproveKobo: 1_000_000_00,
  },
} as const;

export type KycTier = keyof typeof KYC_TIERS;

export const WITHDRAWAL = {
  minKobo: 500_00,                    // ₦500
  feeKobo: 0,                         // absorb it — it is a selling point
  /** Payouts outside these hours queue for the next window. NIBSS is
   *  reliable overnight, but PSP support is not. Widen once stable. */
  instantWindow: { fromHour: 6, toHour: 23 },
  /** Manual review if the account's deposits have not been played. */
  minTurnoverRatio: 0.6,
};

/* ================================================================== */

export type WithdrawalRejection =
  | { code: "below_min"; min: number }
  | { code: "above_tier_limit"; max: number; tier: KycTier }
  | { code: "daily_limit"; remaining: number }
  | { code: "insufficient_funds"; withdrawable: number }
  | { code: "kyc_upgrade_required"; needed: KycTier; missing: string[] }
  | { code: "account_not_verified" }
  | { code: "name_mismatch" }
  | { code: "self_excluded" }
  | { code: "open_bets_only"; note: string };

export interface WithdrawalRequest {
  userId: string;
  bankAccountId: string;
  amountKobo: number;
  idempotencyKey: string;
}

export class WithdrawalService {
  constructor(
    private pool: Pool,
    private ledger: LedgerService,
    private psp: PspRouter,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Request                                                           */
  /* ---------------------------------------------------------------- */

  async request(req: WithdrawalRequest): Promise<
    | { ok: true; withdrawalId: string; status: string; etaMinutes: number }
    | { ok: false; rejection: WithdrawalRejection }
  > {
    if (req.amountKobo < WITHDRAWAL.minKobo) {
      return { ok: false, rejection: { code: "below_min", min: WITHDRAWAL.minKobo } };
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      /* --- lock the user row so two concurrent requests cannot both pass --- */
      const u = await client.query(
        `SELECT u.id, u.status, k.tier, k.status AS kyc_status, k.verified_name
           FROM users u LEFT JOIN kyc_profiles k ON k.user_id = u.id
          WHERE u.id = $1 FOR UPDATE OF u`,
        [req.userId]
      );
      if (!u.rowCount) throw new Error("user not found");
      const user = u.rows[0];

      if (user.status === "self_excluded") {
        await client.query("ROLLBACK");
        return { ok: false, rejection: { code: "self_excluded" } };
      }

      const tier: KycTier = (user.tier ?? "tier_0") as KycTier;
      const rules = KYC_TIERS[tier];

      if (rules.maxPerWithdrawalKobo === 0) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          rejection: { code: "kyc_upgrade_required", needed: "tier_1", missing: ["phone"] },
        };
      }

      if (req.amountKobo > rules.maxPerWithdrawalKobo) {
        const next = nextTier(tier);
        await client.query("ROLLBACK");
        return next
          ? { ok: false, rejection: { code: "kyc_upgrade_required", needed: next, missing: missingFor(next, tier) } }
          : { ok: false, rejection: { code: "above_tier_limit", max: rules.maxPerWithdrawalKobo, tier } };
      }

      /* --- daily ceiling --- */
      const today = await client.query(
        `SELECT COALESCE(SUM(amount_kobo), 0)::bigint AS total FROM withdrawals
          WHERE user_id = $1 AND status <> 'rejected' AND status <> 'failed'
            AND created_at > date_trunc('day', now())`,
        [req.userId]
      );
      const remaining = rules.maxDailyKobo - Number(today.rows[0].total);
      if (req.amountKobo > remaining) {
        await client.query("ROLLBACK");
        return { ok: false, rejection: { code: "daily_limit", remaining: Math.max(0, remaining) } };
      }

      /* --- funds --- */
      const bal = await this.ledger.balance(req.userId, client);
      if (bal.withdrawableKobo < req.amountKobo) {
        await client.query("ROLLBACK");
        return { ok: false, rejection: { code: "insufficient_funds", withdrawable: bal.withdrawableKobo } };
      }

      /* --- bank account must be verified and name-matched --- */
      const acct = await client.query(
        `SELECT id, bank_code, account_number, account_name, verified_at
           FROM bank_accounts WHERE id = $1 AND user_id = $2`,
        [req.bankAccountId, req.userId]
      );
      if (!acct.rowCount || !acct.rows[0].verified_at) {
        await client.query("ROLLBACK");
        return { ok: false, rejection: { code: "account_not_verified" } };
      }

      // Third-party payouts are the classic money-laundering route and
      // the classic account-takeover cash-out. Names must match.
      if (user.verified_name && !namesMatch(user.verified_name, acct.rows[0].account_name)) {
        await client.query("ROLLBACK");
        return { ok: false, rejection: { code: "name_mismatch" } };
      }

      /* --- risk gate --- */
      const risk = await this.riskCheck(client, req.userId, req.amountKobo, tier);

      /* --- hold the funds immediately --- */
      await this.ledger.post({
        reason: "withdrawal",
        idempotencyKey: `withdraw_hold:${req.idempotencyKey}`,
        postings: POSTINGS.withdrawalHold(req.userId, req.amountKobo),
        client,
      });

      const status = risk.autoApprove ? "approved" : "review";
      const w = await client.query(
        `INSERT INTO withdrawals
           (user_id, bank_account_id, amount_kobo, fee_kobo, status, auto_approved)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [req.userId, req.bankAccountId, req.amountKobo, WITHDRAWAL.feeKobo, status, risk.autoApprove]
      );

      await client.query("COMMIT");

      const id = w.rows[0].id as string;
      if (risk.autoApprove) await this.enqueue("payout", { withdrawalId: id });

      return {
        ok: true,
        withdrawalId: id,
        status,
        etaMinutes: risk.autoApprove ? 3 : 240,
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Risk                                                              */
  /* ---------------------------------------------------------------- */

  private async riskCheck(
    client: PoolClient, userId: string, amountKobo: number, tier: KycTier
  ): Promise<{ autoApprove: boolean; reasons: string[] }> {
    const reasons: string[] = [];
    const rules = KYC_TIERS[tier];

    if (amountKobo > rules.autoApproveKobo) reasons.push("above auto-approve ceiling");

    const hour = new Date().getHours();
    if (hour < WITHDRAWAL.instantWindow.fromHour || hour >= WITHDRAWAL.instantWindow.toHour) {
      reasons.push("outside instant window");
    }

    /**
     * Turnover check. Someone who deposits ₦200k, places one ₦500 bet
     * and withdraws ₦199,500 is using you as a money transmitter, not
     * a bookmaker. That is the pattern regulators ask about.
     */
    const t = await client.query(
      `SELECT
         (SELECT COALESCE(SUM(amount_kobo),0) FROM deposits
           WHERE user_id = $1 AND status = 'succeeded')::bigint AS deposited,
         (SELECT COALESCE(SUM(stake_kobo),0) FROM bets
           WHERE user_id = $1)::bigint AS staked`,
      [userId]
    );
    const deposited = Number(t.rows[0].deposited);
    const staked = Number(t.rows[0].staked);
    if (deposited > 0 && staked / deposited < WITHDRAWAL.minTurnoverRatio) {
      reasons.push("low turnover ratio");
    }

    // Bank account changed recently — a common account-takeover signal.
    const recent = await client.query(
      `SELECT 1 FROM bank_accounts
        WHERE user_id = $1 AND created_at > now() - interval '24 hours' LIMIT 1`,
      [userId]
    );
    if (recent.rowCount) reasons.push("new bank account within 24h");

    const flags = await client.query(
      `SELECT flags FROM user_risk_profiles WHERE user_id = $1`, [userId]
    );
    if (flags.rowCount && (flags.rows[0].flags ?? []).length) reasons.push("risk flags present");

    return { autoApprove: reasons.length === 0, reasons };
  }

  /* ---------------------------------------------------------------- */
  /* Payout worker                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Idempotent on the withdrawal ID. The reference sent to the PSP is
   * derived from the ID, so a duplicate job produces a duplicate-
   * reference error rather than a duplicate payment.
   */
  async executePayout(withdrawalId: string): Promise<{ status: string; message?: string }> {
    const row = await this.pool.query(
      `SELECT w.*, b.bank_code, b.account_number, b.account_name
         FROM withdrawals w JOIN bank_accounts b ON b.id = w.bank_account_id
        WHERE w.id = $1`,
      [withdrawalId]
    );
    if (!row.rowCount) return { status: "unknown" };
    const w = row.rows[0];

    if (!["approved", "processing"].includes(w.status)) {
      return { status: w.status, message: "not payable in current state" };
    }

    const reference = `wd_${String(withdrawalId).replace(/-/g, "").slice(0, 20)}`;
    const adapter = this.psp.get(w.provider as PspName | undefined);

    await this.pool.query(
      `UPDATE withdrawals SET status = 'processing', provider = $1, provider_ref = $2 WHERE id = $3`,
      [adapter.name, reference, withdrawalId]
    );

    try {
      const recipient = await adapter.createRecipient({
        bankCode: w.bank_code,
        accountNumber: w.account_number,
        name: w.account_name,
      });

      const res = await adapter.transfer({
        recipientCode: recipient.recipientCode,
        amountKobo: Number(w.amount_kobo) - Number(w.fee_kobo),
        reference,
        reason: "Footly withdrawal",
      });

      if (res.status === "success") {
        await this.markPaid(withdrawalId);
        return { status: "paid" };
      }
      if (res.status === "failed") {
        await this.markFailed(withdrawalId, res.message ?? "transfer failed");
        return { status: "failed", message: res.message };
      }
      // pending — the transfer webhook or the sweep will finalise it
      return { status: "processing" };
    } catch (e) {
      const err = e as PspError;
      if (err instanceof PspError && err.retryable) {
        // Leave it processing. The retry queue picks it up; do NOT
        // reverse the hold, or a retry could pay twice.
        return { status: "processing", message: err.message };
      }
      await this.markFailed(withdrawalId, (e as Error).message);
      return { status: "failed", message: (e as Error).message };
    }
  }

  async markPaid(withdrawalId: string) {
    await this.pool.query(
      `UPDATE withdrawals SET status = 'paid', paid_at = now()
        WHERE id = $1 AND status <> 'paid'`,
      [withdrawalId]
    );
    // The money already left user_cash at request time and sits in
    // psp_settlement. Payment confirms that movement; nothing to post.
  }

  async markFailed(withdrawalId: string, reason: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(
        `UPDATE withdrawals SET status = 'failed', rejection_reason = $2
          WHERE id = $1 AND status NOT IN ('paid', 'failed')
        RETURNING user_id, amount_kobo`,
        [withdrawalId, reason]
      );
      if (r.rowCount) {
        await this.ledger.post({
          reason: "withdrawal_reversal",
          idempotencyKey: `withdraw_reverse:${withdrawalId}`,
          reference: withdrawalId,
          note: reason,
          postings: POSTINGS.withdrawalReversal(r.rows[0].user_id, Number(r.rows[0].amount_kobo)),
          client,
        });
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  /** Manual decision from the admin console. */
  async review(withdrawalId: string, adminId: string, decision: "approve" | "reject", note?: string) {
    if (decision === "reject") {
      await this.markFailed(withdrawalId, note ?? "rejected in review");
      await this.pool.query(
        `UPDATE withdrawals SET status = 'rejected', reviewed_by = $2, reviewed_at = now()
          WHERE id = $1`,
        [withdrawalId, adminId]
      );
      return;
    }
    await this.pool.query(
      `UPDATE withdrawals SET status = 'approved', reviewed_by = $2, reviewed_at = now()
        WHERE id = $1 AND status = 'review'`,
      [withdrawalId, adminId]
    );
    await this.enqueue("payout", { withdrawalId });
  }

  /**
   * Sweep for transfers stuck in processing. PSP transfer webhooks are
   * even less reliable than charge webhooks.
   */
  async reconcileProcessing(): Promise<{ checked: number; resolved: number }> {
    const rows = await this.pool.query(
      `SELECT id, provider, provider_ref FROM withdrawals
        WHERE status = 'processing' AND created_at < now() - interval '3 minutes'
        ORDER BY created_at LIMIT 200`
    );

    let resolved = 0;
    for (const r of rows.rows) {
      if (!r.provider_ref) continue;
      try {
        const res = await this.psp.get(r.provider).fetchTransfer(r.provider_ref);
        if (res.status === "success") { await this.markPaid(r.id); resolved++; }
        else if (res.status === "failed" || res.status === "reversed") {
          await this.markFailed(r.id, res.message ?? res.status);
          resolved++;
        }
      } catch {
        // try again next sweep
      }
    }
    return { checked: rows.rowCount ?? 0, resolved };
  }

  private async enqueue(_job: string, _payload: unknown): Promise<void> {}
}

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

const TIER_ORDER: KycTier[] = ["tier_0", "tier_1", "tier_2", "tier_3"];

function nextTier(current: KycTier): KycTier | null {
  const i = TIER_ORDER.indexOf(current);
  return i >= 0 && i < TIER_ORDER.length - 1 ? TIER_ORDER[i + 1] : null;
}

function missingFor(target: KycTier, current: KycTier): string[] {
  const have = new Set<string>(KYC_TIERS[current].requires);
  return KYC_TIERS[target].requires.filter((r) => !have.has(r));
}

/**
 * Nigerian bank names come back in inconsistent order and with middle
 * names present or absent. Compare the token sets, require at least two
 * matching tokens, and send anything else to a human rather than
 * bouncing a legitimate payout.
 */
export function namesMatch(a: string, b: string): boolean {
  const norm = (s: string) =>
    new Set(
      s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((t) => t.length > 1)
    );
  const A = norm(a), B = norm(b);
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared >= 2 || (A.size === 1 && B.size >= 1 && shared === 1);
}
