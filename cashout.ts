/**
 * CASH-OUT ENGINE
 * ---------------
 * Offers a punter a price to close an open bet before it settles.
 *
 * Three ways books get hurt here, all avoidable:
 *
 *   1. Offering a stale price during a live event. The punter cashes
 *      out the instant a goal goes in, before the feed tells you.
 *      Mitigation: suspend on every market suspension, and re-verify
 *      the quote at acceptance rather than trusting the one you sent.
 *
 *   2. Offering on a leg whose price has drifted but not settled — a
 *      postponed match sitting at its last traded price. Any leg the
 *      feed cannot currently price kills the whole offer.
 *
 *   3. Pricing off the ORIGINAL odds instead of current ones. Cash-out
 *      value comes entirely from how the remaining legs are priced
 *      right now. The price the punter took is irrelevant except as
 *      the multiplier on their locked-in legs.
 */

import type { Pool, PoolClient } from "pg";
import { LedgerService, POSTINGS } from "./ledger";

/* ================================================================== */
/* Config                                                              */
/* ================================================================== */

export const CASHOUT = {
  /** Our cut of the fair value. 8% means we offer 92% of true worth. */
  marginPercent: 0.08,
  /** Offers expire fast. A stale offer is a free option for the punter. */
  offerTtlSeconds: 12,
  /** Below this the offer is not worth the round trip. */
  minOfferKobo: 50_00,
  /** Partial cash-out floor — leave a meaningful bet running. */
  minRemainingStakeKobo: 100_00,
  /** Live events need a fresher price than pre-match ones. */
  maxPriceAgeMsLive: 6_000,
  maxPriceAgeMsPrematch: 120_000,
  realMoneyEnabled: false,
};

export type CashoutUnavailable =
  | { code: "bet_settled" }
  | { code: "leg_suspended"; marketId: string }
  | { code: "leg_stale"; marketId: string }
  | { code: "leg_lost" }
  | { code: "market_not_cashoutable"; marketKey: string }
  | { code: "below_minimum"; min: number }
  | { code: "disabled" };

export interface CashoutQuote {
  betId: string;
  offerKobo: number;
  /** What they would get if every remaining leg wins. */
  fullReturnKobo: number;
  /** Fair value before our margin — logged, never shown. */
  fairValueKobo: number;
  legsWon: number;
  legsRemaining: number;
  expiresAt: string;
  offerId: string;
  /** Partial cash-out options, if the bet supports them. */
  partials?: { percent: number; offerKobo: number; remainingStakeKobo: number }[];
}

interface OpenLeg {
  legId: string;
  marketId: string;
  marketKey: string;
  outcomeId: string;
  /** Price the punter locked in. */
  takenPrice: number;
  /** What that outcome is priced at right now. */
  currentPrice: number | null;
  marketStatus: string;
  cashoutEnabled: boolean;
  priceAgeMs: number;
  eventLive: boolean;
  status: string;
}

/* ================================================================== */

export class CashoutService {
  constructor(private pool: Pool, private ledger: LedgerService) {}

  /* ---------------------------------------------------------------- */
  /* Quoting                                                           */
  /* ---------------------------------------------------------------- */

  async quote(betId: string, userId: string): Promise<
    { ok: true; quote: CashoutQuote } | { ok: false; reason: CashoutUnavailable }
  > {
    const bet = await this.pool.query(
      `SELECT id, user_id, stake_kobo, bonus_stake_kobo, total_odds, status, bonus_multiplier
         FROM bets WHERE id = $1 AND user_id = $2`,
      [betId, userId]
    );
    if (!bet.rowCount) return { ok: false, reason: { code: "bet_settled" } };
    const b = bet.rows[0];

    if (b.status !== "open") return { ok: false, reason: { code: "bet_settled" } };

    // Bonus-funded stakes do not cash out. Otherwise a free bet becomes
    // instant cash at roughly its face value, which is the whole point
    // of not giving cash in the first place.
    if (Number(b.bonus_stake_kobo) > 0) return { ok: false, reason: { code: "disabled" } };

    const legs = await this.loadLegs(betId);

    if (legs.some((l) => l.status === "lost")) {
      return { ok: false, reason: { code: "leg_lost" } };
    }

    const open = legs.filter((l) => l.status === "open");
    const settledWon = legs.filter((l) => l.status === "won" || l.status === "half_won");

    /* --- every open leg must be currently priceable --- */
    for (const l of open) {
      if (!l.cashoutEnabled) {
        return { ok: false, reason: { code: "market_not_cashoutable", marketKey: l.marketKey } };
      }
      if (l.marketStatus !== "open" || l.currentPrice === null) {
        return { ok: false, reason: { code: "leg_suspended", marketId: l.marketId } };
      }
      const maxAge = l.eventLive ? CASHOUT.maxPriceAgeMsLive : CASHOUT.maxPriceAgeMsPrematch;
      if (l.priceAgeMs > maxAge) {
        return { ok: false, reason: { code: "leg_stale", marketId: l.marketId } };
      }
    }

    /* --- fair value --- */
    const stake = Number(b.stake_kobo);
    const fullReturn = Math.round(stake * Number(b.total_odds) * Number(b.bonus_multiplier ?? 1));
    const fair = this.fairValue(stake, legs);

    const offer = Math.round(fair * (1 - CASHOUT.marginPercent));

    if (offer < CASHOUT.minOfferKobo) {
      return { ok: false, reason: { code: "below_minimum", min: CASHOUT.minOfferKobo } };
    }

    /* --- persist the offer so acceptance can verify it --- */
    const expiresAt = new Date(Date.now() + CASHOUT.offerTtlSeconds * 1000);
    const saved = await this.pool.query(
      `INSERT INTO cashout_offers (bet_id, amount_kobo, expires_at)
       VALUES ($1, $2, $3) RETURNING id`,
      [betId, offer, expiresAt]
    );

    return {
      ok: true,
      quote: {
        betId,
        offerKobo: offer,
        fullReturnKobo: fullReturn,
        fairValueKobo: fair,
        legsWon: settledWon.length,
        legsRemaining: open.length,
        expiresAt: expiresAt.toISOString(),
        offerId: saved.rows[0].id,
        partials: this.partialOptions(offer, stake),
      },
    };
  }

  /**
   * Fair value = stake × (odds already banked) × P(remaining legs all win).
   *
   * The banked multiplier comes from legs that have already resolved.
   * The probability of the rest comes from CURRENT prices, margin
   * stripped — not from the prices the punter took.
   */
  private fairValue(stakeKobo: number, legs: OpenLeg[]): number {
    let bankedMultiplier = 1;
    let remainingProbability = 1;

    for (const l of legs) {
      if (l.status === "won") {
        bankedMultiplier *= l.takenPrice;
      } else if (l.status === "half_won") {
        bankedMultiplier *= (1 + l.takenPrice) / 2;
      } else if (l.status === "half_lost") {
        bankedMultiplier *= 0.5;
      } else if (l.status === "void") {
        bankedMultiplier *= 1;
      } else if (l.status === "open" && l.currentPrice) {
        // Locked-in price stays in the multiplier; current price gives
        // the probability. Both matter and they are different numbers.
        bankedMultiplier *= l.takenPrice;
        remainingProbability *= stripMargin(l.currentPrice);
      }
    }

    return Math.round(stakeKobo * bankedMultiplier * remainingProbability);
  }

  private partialOptions(offer: number, stake: number) {
    return [25, 50, 75]
      .map((percent) => ({
        percent,
        offerKobo: Math.round(offer * (percent / 100)),
        remainingStakeKobo: Math.round(stake * (1 - percent / 100)),
      }))
      .filter(
        (p) =>
          p.offerKobo >= CASHOUT.minOfferKobo &&
          p.remainingStakeKobo >= CASHOUT.minRemainingStakeKobo
      );
  }

  /* ---------------------------------------------------------------- */
  /* Acceptance                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Re-quotes before paying. The offer the punter is holding is a
   * request, not a contract — between render and tap, a goal may have
   * gone in. If the fresh price differs by more than a hair, reject and
   * show the new number rather than honouring the old one.
   */
  async accept(args: {
    betId: string;
    userId: string;
    offerId: string;
    /** Percent of the bet to close. 100 = full cash out. */
    percent?: number;
    idempotencyKey: string;
  }): Promise<
    | { ok: true; paidKobo: number; remainingStakeKobo: number }
    | { ok: false; reason: CashoutUnavailable | { code: "offer_expired" } | { code: "price_moved"; newOfferKobo: number } }
  > {
    const percent = args.percent ?? 100;

    const offerRow = await this.pool.query(
      `SELECT id, bet_id, amount_kobo, expires_at, accepted_at, invalidated
         FROM cashout_offers WHERE id = $1 AND bet_id = $2`,
      [args.offerId, args.betId]
    );
    if (!offerRow.rowCount) return { ok: false, reason: { code: "offer_expired" } };
    const offer = offerRow.rows[0];

    if (offer.accepted_at) {
      // Idempotent replay — the ledger key below dedupes the payment.
      return { ok: true, paidKobo: Number(offer.amount_kobo), remainingStakeKobo: 0 };
    }
    if (offer.invalidated || new Date(offer.expires_at) < new Date()) {
      return { ok: false, reason: { code: "offer_expired" } };
    }

    /* --- the critical re-check --- */
    const fresh = await this.quote(args.betId, args.userId);
    if (!fresh.ok) return { ok: false, reason: fresh.reason };

    const drift = Math.abs(fresh.quote.offerKobo - Number(offer.amount_kobo)) / Number(offer.amount_kobo);
    if (drift > 0.005) {
      await this.invalidate(args.offerId);
      return { ok: false, reason: { code: "price_moved", newOfferKobo: fresh.quote.offerKobo } };
    }

    const payout = Math.round(Number(offer.amount_kobo) * (percent / 100));

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const bet = await client.query(
        `SELECT stake_kobo, status FROM bets WHERE id = $1 FOR UPDATE`,
        [args.betId]
      );
      if (bet.rows[0].status !== "open") {
        await client.query("ROLLBACK");
        return { ok: false, reason: { code: "bet_settled" } };
      }

      const stake = Number(bet.rows[0].stake_kobo);
      const closedStake = Math.round(stake * (percent / 100));
      const remainingStake = stake - closedStake;

      /* --- release the closed portion, pay the offer --- */
      await this.ledger.post({
        reason: "cashout",
        idempotencyKey: `cashout:${args.idempotencyKey}`,
        reference: args.betId,
        note: percent < 100 ? `partial ${percent}%` : "full cash out",
        postings: [
          { userId: args.userId, kind: "user_locked", amountKobo: -closedStake },
          { userId: args.userId, kind: "user_cash", amountKobo: payout },
          { kind: "house_liability", amountKobo: closedStake - payout },
        ],
        client,
      });

      if (remainingStake <= 0) {
        await client.query(
          `UPDATE bets SET status = 'cashed_out', cashout_kobo = $2, payout_kobo = $2,
                  settled_at = now() WHERE id = $1`,
          [args.betId, payout]
        );
      } else {
        // Partial: the bet stays open at a reduced stake. Potential
        // return scales with it so My Bets stays truthful.
        await client.query(
          `UPDATE bets
              SET stake_kobo = $2,
                  potential_return = ROUND(potential_return * $3),
                  cashout_kobo = COALESCE(cashout_kobo, 0) + $4
            WHERE id = $1`,
          [args.betId, remainingStake, remainingStake / stake, payout]
        );
      }

      await client.query(
        `UPDATE cashout_offers SET accepted_at = now() WHERE id = $1`, [args.offerId]
      );

      await client.query("COMMIT");
      return { ok: true, paidKobo: payout, remainingStakeKobo: Math.max(0, remainingStake) };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Invalidation                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Called by the feed pipeline the moment a market suspends or a leg
   * settles. Every outstanding offer on an affected bet dies instantly.
   * This is the hook that stops goal-latency arbitrage.
   */
  async invalidateForMarket(marketId: string): Promise<number> {
    const res = await this.pool.query(
      `UPDATE cashout_offers SET invalidated = true
        WHERE accepted_at IS NULL AND NOT invalidated
          AND bet_id IN (SELECT bet_id FROM bet_legs WHERE market_id = $1)
      RETURNING id`,
      [marketId]
    );
    return res.rowCount ?? 0;
  }

  async invalidate(offerId: string) {
    await this.pool.query(
      `UPDATE cashout_offers SET invalidated = true WHERE id = $1`, [offerId]
    );
  }

  /** Housekeeping — offers are short-lived and pile up fast. */
  async purgeExpired(olderThanHours = 24) {
    await this.pool.query(
      `DELETE FROM cashout_offers
        WHERE accepted_at IS NULL AND created_at < now() - ($1 || ' hours')::interval`,
      [olderThanHours]
    );
  }

  /* ---------------------------------------------------------------- */

  private async loadLegs(betId: string): Promise<OpenLeg[]> {
    const res = await this.pool.query(
      `SELECT l.id AS leg_id, l.market_id, l.outcome_id, l.price AS taken_price, l.status,
              m.market_key, m.status AS market_status,
              EXTRACT(EPOCH FROM (now() - m.updated_at)) * 1000 AS price_age_ms,
              mt.cashout AS cashout_enabled,
              o.price AS current_price,
              e.status = 'live' AS event_live
         FROM bet_legs l
         JOIN markets m ON m.id = l.market_id
         JOIN market_types mt ON mt.key = m.market_key
         JOIN events e ON e.id = m.event_id
         LEFT JOIN outcomes o ON o.id = l.outcome_id
        WHERE l.bet_id = $1`,
      [betId]
    );

    return res.rows.map((r) => ({
      legId: r.leg_id,
      marketId: r.market_id,
      marketKey: r.market_key,
      outcomeId: r.outcome_id,
      takenPrice: Number(r.taken_price),
      currentPrice: r.current_price === null ? null : Number(r.current_price),
      marketStatus: r.market_status,
      cashoutEnabled: r.cashout_enabled,
      priceAgeMs: Number(r.price_age_ms ?? 0),
      eventLive: !!r.event_live,
      status: r.status,
    }));
  }
}

/* ================================================================== */

/** Removes our overround so a published price becomes a probability. */
const stripMargin = (price: number) => Math.min(0.999, (1 / price) / 1.06);

/* ------------------------------------------------------------------ */
/* Worked example                                                      */
/* ------------------------------------------------------------------ */

/**
 * ₦1,000 five-leg acca at 12.40. Three legs won, two still open,
 * currently priced 1.50 and 2.10.
 *
 *   Banked multiplier  = product of all five taken prices  = 12.40
 *   Remaining P(win)   = (1/1.50 / 1.06) × (1/2.10 / 1.06) = 0.283
 *   Fair value         = 1,000 × 12.40 × 0.283             = ₦3,509
 *   Offer at 8% margin                                     = ₦3,228
 *
 * Full return if both land is ₦12,400. The punter is trading ₦9,172 of
 * upside for certainty — which is exactly the product, and exactly why
 * the offer must be re-verified before it is honoured.
 */
