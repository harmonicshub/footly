/**
 * BONUS ENGINE
 * ------------
 * Promotions are where books lose money quietly. Not through fraud —
 * through rules that were never precisely defined, so the engine and
 * the terms page disagree and you honour whichever the punter read.
 *
 * So: every promotion is a row of typed rules, evaluated by one
 * function. Nothing here is hardcoded per campaign. If marketing wants
 * a new offer, they write a rules JSON, not a ticket for you.
 *
 * Bonus funds live in a SEPARATE ledger account from cash. That
 * separation is structural, not a flag on a balance — see ledger.ts.
 */

import type { Pool, PoolClient } from "pg";
import { LedgerService, POSTINGS } from "./ledger";

/* ================================================================== */
/* Rule vocabulary                                                     */
/* ================================================================== */

export type BonusKind =
  | "welcome" | "deposit_match" | "free_bet" | "acca_boost"
  | "acca_insurance" | "cashback" | "referral";

export interface BonusRules {
  /** Every leg must be at least this price to qualify. */
  minOddsPerLeg?: number;
  /** Total accumulated odds must reach this. */
  minTotalOdds?: number;
  minLegs?: number;
  maxLegs?: number;
  minStakeKobo?: number;
  minDepositKobo?: number;
  /** Match percentage for deposit offers. 100 = double the deposit. */
  matchPercent?: number;
  maxGrantKobo?: number;
  /** Turnover multiple before bonus converts to cash. 5 = stake it 5×. */
  wageringMultiple?: number;
  /** Only these market keys count toward wagering. Empty = all. */
  eligibleMarkets?: string[];
  /** These market keys never count — usually low-margin ones. */
  excludedMarkets?: string[];
  eligibleSports?: string[];
  /** Bet types that qualify. Singles-only offers must say so. */
  eligibleBetTypes?: ("single" | "multiple" | "system" | "builder")[];
  expiryDays?: number;
  /** Acca insurance: refund if exactly this many legs lose. */
  insuranceLegsLost?: number;
  maxRefundKobo?: number;
  /** Cashback percentage on net losses over the period. */
  cashbackPercent?: number;
  /** One grant per what — account, device, bank account, or all three. */
  uniquenessScope?: ("account" | "device" | "bank_account" | "ip")[];
}

export interface Promotion {
  id: string;
  code?: string;
  kind: BonusKind;
  name: string;
  terms: string;
  rules: BonusRules;
  startsAt: Date;
  endsAt?: Date;
  maxGrants?: number;
  grantsIssued: number;
  active: boolean;
}

export interface BetContext {
  betId: string;
  userId: string;
  betType: "single" | "multiple" | "system" | "builder";
  stakeKobo: number;
  cashStakeKobo: number;
  bonusStakeKobo: number;
  totalOdds: number;
  legs: { marketKey: string; sportId: string; price: number; status: string }[];
}

/* ================================================================== */
/* Qualification                                                       */
/* ================================================================== */

export type Disqualifier =
  | "below_min_stake" | "below_min_odds" | "leg_below_min_odds"
  | "too_few_legs" | "too_many_legs" | "bet_type_not_eligible"
  | "market_excluded" | "sport_not_eligible";

/**
 * Single source of truth for "does this bet qualify". The bet slip
 * calls it to show the punter their bonus BEFORE they stake — that
 * preview and the settlement must never disagree.
 */
export function qualifies(bet: BetContext, rules: BonusRules): {
  ok: boolean; reasons: Disqualifier[];
} {
  const reasons: Disqualifier[] = [];

  if (rules.minStakeKobo && bet.stakeKobo < rules.minStakeKobo) reasons.push("below_min_stake");
  if (rules.minTotalOdds && bet.totalOdds < rules.minTotalOdds) reasons.push("below_min_odds");
  if (rules.minLegs && bet.legs.length < rules.minLegs) reasons.push("too_few_legs");
  if (rules.maxLegs && bet.legs.length > rules.maxLegs) reasons.push("too_many_legs");

  if (rules.eligibleBetTypes && !rules.eligibleBetTypes.includes(bet.betType)) {
    reasons.push("bet_type_not_eligible");
  }

  if (rules.minOddsPerLeg && bet.legs.some((l) => l.price < rules.minOddsPerLeg!)) {
    reasons.push("leg_below_min_odds");
  }

  if (rules.excludedMarkets?.length && bet.legs.some((l) => rules.excludedMarkets!.includes(l.marketKey))) {
    reasons.push("market_excluded");
  }
  if (rules.eligibleMarkets?.length && bet.legs.some((l) => !rules.eligibleMarkets!.includes(l.marketKey))) {
    reasons.push("market_excluded");
  }
  if (rules.eligibleSports?.length && bet.legs.some((l) => !rules.eligibleSports!.includes(l.sportId))) {
    reasons.push("sport_not_eligible");
  }

  return { ok: reasons.length === 0, reasons };
}

/* ================================================================== */
/* Accumulator bonus                                                   */
/* ================================================================== */

/**
 * The headline number every Nigerian book advertises. Two rules that
 * are easy to get wrong and expensive both ways:
 *
 *   1. Legs priced below the qualifying odds do not count toward the
 *      leg count. Otherwise punters pad a 5-leg acca with five 1.01
 *      selections and collect the 10-leg multiplier for free.
 *   2. The bonus applies to WINNINGS, not to the stake. On a ₦1,000
 *      stake at 20.00 with a 30% bonus, the punter gets
 *      ₦1,000 + (₦19,000 × 1.30) = ₦25,700 — not ₦26,000.
 */
export const ACCA_TIERS: { minLegs: number; multiplier: number }[] = [
  { minLegs: 3, multiplier: 1.03 },
  { minLegs: 5, multiplier: 1.08 },
  { minLegs: 7, multiplier: 1.15 },
  { minLegs: 10, multiplier: 1.30 },
  { minLegs: 13, multiplier: 1.60 },
  { minLegs: 16, multiplier: 2.10 },
  { minLegs: 20, multiplier: 2.70 },
];

export const ACCA_MIN_LEG_ODDS = 1.20;

export function accaMultiplier(legs: { price: number; status?: string }[]): number {
  // Void legs are removed before counting — a 10-leg acca with two
  // postponed matches is an 8-leg acca for bonus purposes.
  const counted = legs.filter(
    (l) => l.price >= ACCA_MIN_LEG_ODDS && l.status !== "void"
  ).length;

  let m = 1;
  for (const t of ACCA_TIERS) if (counted >= t.minLegs) m = t.multiplier;
  return m;
}

export function accaPayout(stakeKobo: number, totalOdds: number, multiplier: number): {
  basePayoutKobo: number; bonusKobo: number; totalKobo: number;
} {
  const base = Math.round(stakeKobo * totalOdds);
  const winnings = base - stakeKobo;
  const bonus = Math.round(winnings * (multiplier - 1));
  return { basePayoutKobo: base, bonusKobo: bonus, totalKobo: base + bonus };
}

/* ================================================================== */
/* Engine                                                              */
/* ================================================================== */

export class BonusEngine {
  constructor(private pool: Pool, private ledger: LedgerService) {}

  /* ---------------------------------------------------------------- */
  /* Granting                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Called after a qualifying deposit or on signup. Uniqueness checks
   * run against device and bank account as well as user ID — bonus
   * abuse in this market is farmed at scale with cheap SIMs, and one
   * check on user ID stops none of it.
   */
  async grant(args: {
    userId: string;
    promotionId: string;
    depositKobo?: number;
    deviceId?: string;
    bankAccountId?: string;
    ip?: string;
  }): Promise<{ granted: boolean; amountKobo?: number; reason?: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const p = await this.loadPromotion(client, args.promotionId);
      if (!p) { await client.query("ROLLBACK"); return { granted: false, reason: "promotion not found" }; }
      if (!p.active) { await client.query("ROLLBACK"); return { granted: false, reason: "inactive" }; }

      const now = new Date();
      if (p.startsAt > now || (p.endsAt && p.endsAt < now)) {
        await client.query("ROLLBACK");
        return { granted: false, reason: "outside promotion window" };
      }
      if (p.maxGrants && p.grantsIssued >= p.maxGrants) {
        await client.query("ROLLBACK");
        return { granted: false, reason: "fully claimed" };
      }

      const dupe = await this.checkUniqueness(client, p, args);
      if (dupe) { await client.query("ROLLBACK"); return { granted: false, reason: dupe }; }

      /* ---- size the grant ---- */
      let amount = 0;
      if (p.kind === "deposit_match" || p.kind === "welcome") {
        const dep = args.depositKobo ?? 0;
        if (p.rules.minDepositKobo && dep < p.rules.minDepositKobo) {
          await client.query("ROLLBACK");
          return { granted: false, reason: "deposit below minimum" };
        }
        amount = Math.round(dep * ((p.rules.matchPercent ?? 100) / 100));
      } else if (p.kind === "free_bet" || p.kind === "referral") {
        amount = p.rules.maxGrantKobo ?? 0;
      }

      if (p.rules.maxGrantKobo) amount = Math.min(amount, p.rules.maxGrantKobo);
      if (amount <= 0) { await client.query("ROLLBACK"); return { granted: false, reason: "nothing to grant" }; }

      const wagering = Math.round(amount * (p.rules.wageringMultiple ?? 0));
      const expires = new Date(now.getTime() + (p.rules.expiryDays ?? 7) * 86_400_000);

      await client.query(
        `INSERT INTO user_bonuses
           (user_id, promotion_id, amount_kobo, wagering_required, status, expires_at)
         VALUES ($1, $2, $3, $4, 'active', $5)
         ON CONFLICT (user_id, promotion_id) DO NOTHING`,
        [args.userId, p.id, amount, wagering, expires]
      );

      await client.query(
        `UPDATE promotions SET grants_issued = grants_issued + 1 WHERE id = $1`, [p.id]
      );

      await this.ledger.post({
        reason: "bonus_grant",
        idempotencyKey: `bonus:${p.id}:${args.userId}`,
        reference: p.id,
        postings: POSTINGS.bonusGrant(args.userId, amount),
        client,
      });

      await client.query("COMMIT");
      return { granted: true, amountKobo: amount };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Stake splitting                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Decides how much of a stake comes from bonus vs cash.
   *
   * Bonus first is the punter-friendly default and the one that gets
   * wagering done. But a bet that does not qualify for the promotion
   * must NOT consume bonus funds — otherwise the punter burns their
   * bonus on an ineligible market and rightly complains.
   */
  async splitStake(userId: string, bet: Omit<BetContext, "cashStakeKobo" | "bonusStakeKobo">): Promise<{
    cashKobo: number; bonusKobo: number; bonusId?: string;
  }> {
    const active = await this.pool.query(
      `SELECT b.id, b.amount_kobo, p.rules
         FROM user_bonuses b JOIN promotions p ON p.id = b.promotion_id
        WHERE b.user_id = $1 AND b.status = 'active' AND b.expires_at > now()
        ORDER BY b.expires_at ASC LIMIT 1`,
      [userId]
    );

    if (!active.rowCount) return { cashKobo: bet.stakeKobo, bonusKobo: 0 };

    const row = active.rows[0];
    const rules: BonusRules = row.rules;
    const check = qualifies({ ...bet, cashStakeKobo: 0, bonusStakeKobo: 0 }, rules);

    if (!check.ok) return { cashKobo: bet.stakeKobo, bonusKobo: 0 };

    const bonusAvailable = Number(row.amount_kobo);
    const bonusKobo = Math.min(bonusAvailable, bet.stakeKobo);
    return { cashKobo: bet.stakeKobo - bonusKobo, bonusKobo, bonusId: row.id };
  }

  /* ---------------------------------------------------------------- */
  /* Wagering progress                                                 */
  /* ---------------------------------------------------------------- */

  /**
   * Called on every settled bet. Only qualifying turnover counts, and
   * only once — running this twice on the same bet must not double the
   * progress, hence the idempotency row.
   */
  async recordTurnover(bet: BetContext): Promise<{ converted: boolean; amountKobo?: number }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const marker = await client.query(
        `INSERT INTO settlement_log (key, payload) VALUES ($1, $2)
         ON CONFLICT (key) DO NOTHING RETURNING key`,
        [`wagering:${bet.betId}`, { betId: bet.betId }]
      );
      if (!marker.rowCount) { await client.query("ROLLBACK"); return { converted: false }; }

      const b = await client.query(
        `SELECT b.id, b.amount_kobo, b.wagering_required, b.wagering_done, p.rules
           FROM user_bonuses b JOIN promotions p ON p.id = b.promotion_id
          WHERE b.user_id = $1 AND b.status = 'active' AND b.expires_at > now()
          ORDER BY b.expires_at ASC LIMIT 1 FOR UPDATE`,
        [bet.userId]
      );
      if (!b.rowCount) { await client.query("COMMIT"); return { converted: false }; }

      const row = b.rows[0];
      if (!qualifies(bet, row.rules).ok) { await client.query("COMMIT"); return { converted: false }; }

      const done = Number(row.wagering_done) + bet.stakeKobo;
      const required = Number(row.wagering_required);

      if (done < required) {
        await client.query(`UPDATE user_bonuses SET wagering_done = $1 WHERE id = $2`, [done, row.id]);
        await client.query("COMMIT");
        return { converted: false };
      }

      /* ---- wagering complete: bonus becomes real money ---- */
      const amount = Number(row.amount_kobo);
      await client.query(
        `UPDATE user_bonuses SET wagering_done = $1, status = 'wagered' WHERE id = $2`,
        [done, row.id]
      );
      await this.ledger.post({
        reason: "bonus_convert",
        idempotencyKey: `bonus_convert:${row.id}`,
        reference: row.id,
        postings: POSTINGS.bonusConvert(bet.userId, amount),
        client,
      });

      await client.query("COMMIT");
      return { converted: true, amountKobo: amount };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Acca insurance / one-cut                                          */
  /* ---------------------------------------------------------------- */

  /**
   * "One leg let you down" — refund as a free bet when exactly N legs
   * lose. Exactly, not at most: a punter whose acca lost zero legs won,
   * and one who lost three does not qualify.
   *
   * Refund is a free bet, not cash. Cash refunds turn this into a
   * negative-margin product overnight.
   */
  async evaluateInsurance(bet: BetContext, promotionId: string): Promise<{
    refunded: boolean; amountKobo?: number;
  }> {
    const p = await this.loadPromotion(this.pool as unknown as PoolClient, promotionId);
    if (!p || p.kind !== "acca_insurance") return { refunded: false };

    if (!qualifies(bet, p.rules).ok) return { refunded: false };

    const lost = bet.legs.filter((l) => l.status === "lost").length;
    const target = p.rules.insuranceLegsLost ?? 1;
    if (lost !== target) return { refunded: false };

    const amount = Math.min(bet.cashStakeKobo, p.rules.maxRefundKobo ?? bet.cashStakeKobo);
    if (amount <= 0) return { refunded: false };

    const expires = new Date(Date.now() + (p.rules.expiryDays ?? 7) * 86_400_000);
    await this.pool.query(
      `INSERT INTO user_bonuses (user_id, promotion_id, amount_kobo, wagering_required, status, expires_at)
       VALUES ($1, $2, $3, 0, 'active', $4)
       ON CONFLICT (user_id, promotion_id) DO UPDATE
         SET amount_kobo = user_bonuses.amount_kobo + EXCLUDED.amount_kobo,
             expires_at = GREATEST(user_bonuses.expires_at, EXCLUDED.expires_at),
             status = 'active'`,
      [bet.userId, p.id, amount, expires]
    );

    await this.ledger.post({
      reason: "bonus_grant",
      idempotencyKey: `insurance:${bet.betId}`,
      reference: bet.betId,
      note: `acca insurance refund, ${lost} leg(s) lost`,
      postings: POSTINGS.bonusGrant(bet.userId, amount),
    });

    return { refunded: true, amountKobo: amount };
  }

  /* ---------------------------------------------------------------- */
  /* Expiry sweep                                                      */
  /* ---------------------------------------------------------------- */

  /** Nightly. Unwagered bonus expires and leaves the balance. */
  async expireBonuses(): Promise<number> {
    const rows = await this.pool.query(
      `UPDATE user_bonuses SET status = 'expired'
        WHERE status = 'active' AND expires_at <= now()
      RETURNING id, user_id, amount_kobo`
    );

    for (const r of rows.rows) {
      await this.ledger.post({
        reason: "bonus_expiry",
        idempotencyKey: `bonus_expire:${r.id}`,
        reference: r.id,
        postings: [
          { userId: r.user_id, kind: "user_bonus", amountKobo: -Number(r.amount_kobo) },
          { kind: "promo_expense", amountKobo: Number(r.amount_kobo) },
        ],
      });
    }
    return rows.rowCount ?? 0;
  }

  /* ---------------------------------------------------------------- */

  private async loadPromotion(client: PoolClient, id: string): Promise<Promotion | null> {
    const r = await client.query(`SELECT * FROM promotions WHERE id = $1`, [id]);
    if (!r.rowCount) return null;
    const p = r.rows[0];
    return {
      id: p.id, code: p.code, kind: p.kind, name: p.name, terms: p.terms,
      rules: p.rules, startsAt: p.starts_at, endsAt: p.ends_at,
      maxGrants: p.max_grants, grantsIssued: p.grants_issued, active: p.active,
    };
  }

  private async checkUniqueness(
    client: PoolClient, p: Promotion,
    args: { userId: string; deviceId?: string; bankAccountId?: string; ip?: string }
  ): Promise<string | null> {
    const scopes = p.rules.uniquenessScope ?? ["account"];

    if (scopes.includes("account")) {
      const r = await client.query(
        `SELECT 1 FROM user_bonuses WHERE user_id = $1 AND promotion_id = $2`,
        [args.userId, p.id]
      );
      if (r.rowCount) return "already claimed on this account";
    }

    if (scopes.includes("bank_account") && args.bankAccountId) {
      const r = await client.query(
        `SELECT 1 FROM user_bonuses ub
           JOIN bank_accounts ba ON ba.user_id = ub.user_id
           JOIN bank_accounts mine ON mine.id = $2
          WHERE ub.promotion_id = $1
            AND ba.account_number = mine.account_number
            AND ba.bank_code = mine.bank_code
            AND ub.user_id <> $3
          LIMIT 1`,
        [p.id, args.bankAccountId, args.userId]
      );
      if (r.rowCount) return "already claimed on this bank account";
    }

    if (scopes.includes("device") && args.deviceId) {
      const r = await client.query(
        `SELECT 1 FROM sessions s JOIN user_bonuses ub ON ub.user_id = s.user_id
          WHERE s.device_label = $1 AND ub.promotion_id = $2 AND ub.user_id <> $3 LIMIT 1`,
        [args.deviceId, p.id, args.userId]
      );
      if (r.rowCount) return "already claimed on this device";
    }

    return null;
  }
}

/* ================================================================== */
/* Sample promotions                                                   */
/* ================================================================== */

export const SAMPLE_PROMOTIONS: Partial<Promotion>[] = [
  {
    code: "WELCOME100",
    kind: "welcome",
    name: "100% first deposit bonus up to ₦50,000",
    terms:
      "Applies to your first deposit only. Bonus must be staked five times on accumulators of three " +
      "or more legs, each priced 1.20 or higher, within seven days. Bonus funds cannot be withdrawn " +
      "until wagering is complete. One claim per account, device and bank account.",
    rules: {
      minDepositKobo: 100_00,
      matchPercent: 100,
      maxGrantKobo: 50_000_00,
      wageringMultiple: 5,
      minLegs: 3,
      minOddsPerLeg: 1.20,
      eligibleBetTypes: ["multiple"],
      expiryDays: 7,
      uniquenessScope: ["account", "device", "bank_account"],
    },
  },
  {
    code: "ONECUT",
    kind: "acca_insurance",
    name: "One cut, we refund",
    terms:
      "Place an accumulator of five or more legs, each priced 1.20 or higher, with a stake of at " +
      "least ₦200. If exactly one leg loses, we refund your stake as a free bet up to ₦10,000. " +
      "Cash stake only — free-bet stakes do not qualify.",
    rules: {
      minLegs: 5,
      minOddsPerLeg: 1.20,
      minStakeKobo: 200_00,
      insuranceLegsLost: 1,
      maxRefundKobo: 10_000_00,
      eligibleBetTypes: ["multiple"],
      expiryDays: 7,
    },
  },
  {
    kind: "acca_boost",
    name: "Accumulator bonus up to 170%",
    terms:
      "Winnings are boosted by leg count. Legs priced under 1.20 do not count toward the total, and " +
      "void legs are removed before counting. The boost applies to winnings, not to your stake.",
    rules: { minLegs: 3, minOddsPerLeg: 1.20, eligibleBetTypes: ["multiple"] },
  },
];
