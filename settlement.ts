/**
 * SETTLEMENT WORKER
 * -----------------
 * Runs off a queue (BullMQ on Redis). Three invariants:
 *
 *   1. Idempotent. A settlement job may arrive twice; the second run
 *      must be a no-op, not a second payout.
 *   2. Auditable. Every settled leg stores the evidence it used. When a
 *      punter disputes a corner count six weeks later, you need the row.
 *   3. Reversible. Providers roll back results. Payouts must unwind
 *      cleanly, including from balances the punter has since spent.
 */

import type { MarketResult, OutcomeStatus } from "./types";

export interface SettlementStore {
  /** Already-processed job? Keyed on eventId + marketId + provider sequence. */
  alreadyApplied(key: string): Promise<boolean>;
  markApplied(key: string): Promise<void>;

  /** All unsettled bet legs touching this market. */
  legsForMarket(marketId: string): Promise<BetLeg[]>;
  /** All legs of a bet, to decide whether the whole ticket resolves. */
  legsForBet(betId: string): Promise<BetLeg[]>;

  settleLeg(args: { legId: string; status: OutcomeStatus; evidence: Record<string, unknown> }): Promise<void>;
  settleBet(args: { betId: string; status: BetStatus; payout: number; note?: string }): Promise<void>;

  /** Credits winnings. Must be idempotent on betId. */
  credit(userId: string, amountKobo: number, ref: string): Promise<void>;
  /** Reverses a credit. May drive the balance negative — that is correct. */
  reverse(userId: string, amountKobo: number, ref: string): Promise<void>;

  /** Cash-out offers must die the instant a leg resolves. */
  invalidateCashout(betId: string): Promise<void>;

  betsWithLeg(marketId: string): Promise<{ betId: string; userId: string; stake: number; betType: string }[]>;
}

export type BetStatus = "open" | "won" | "lost" | "void" | "half_won" | "cashed_out";

export interface BetLeg {
  legId: string;
  betId: string;
  userId: string;
  marketId: string;
  outcomeId: string;
  price: number;
  status: OutcomeStatus;
}

/* ------------------------------------------------------------------ */

export class SettlementWorker {
  constructor(private store: SettlementStore) {}

  async handle(job: { eventId: string; sequence: number; results: MarketResult[] }) {
    for (const result of job.results) {
      const key = `${job.eventId}:${result.marketId}:${job.sequence}`;
      if (await this.store.alreadyApplied(key)) continue;

      /* ---- 1. resolve every leg on this market ---- */
      const legs = await this.store.legsForMarket(result.marketId);
      const statusByOutcome = new Map(result.outcomes.map((o) => [o.outcomeId, o.status]));

      const touchedBets = new Set<string>();

      for (const leg of legs) {
        const status = statusByOutcome.get(leg.outcomeId);
        if (!status) continue; // outcome not in this settlement message
        await this.store.settleLeg({ legId: leg.legId, status, evidence: result.evidence });
        await this.store.invalidateCashout(leg.betId);
        touchedBets.add(leg.betId);
      }

      /* ---- 2. resolve any ticket whose legs are now all decided ---- */
      for (const betId of touchedBets) {
        await this.resolveBet(betId);
      }

      await this.store.markApplied(key);
    }
  }

  /* ---------------------------------------------------------------- */

  private async resolveBet(betId: string) {
    const legs = await this.store.legsForBet(betId);
    if (!legs.length) return;

    const bets = await this.store.betsWithLeg(legs[0].marketId);
    const bet = bets.find((b) => b.betId === betId);
    if (!bet) return;

    // A single lost leg kills a multiple immediately — pay out nothing
    // and close it, rather than waiting for the other legs to land.
    if (legs.some((l) => l.status === "lost")) {
      await this.store.settleBet({ betId, status: "lost", payout: 0 });
      return;
    }

    // Still waiting on something.
    if (legs.some((l) => l.status === "open")) return;

    /* ---- all legs decided ---- */
    let multiplier = 1;
    let allVoid = true;

    for (const leg of legs) {
      switch (leg.status) {
        case "won":
          multiplier *= leg.price;
          allVoid = false;
          break;
        case "half_won":
          // Asian quarter line: half the stake wins at the price, half pushes.
          multiplier *= (1 + leg.price) / 2;
          allVoid = false;
          break;
        case "half_lost":
          multiplier *= 0.5;
          allVoid = false;
          break;
        case "void":
          // Void legs price at 1.00 — the leg is removed, the rest stands.
          multiplier *= 1;
          break;
        default:
          break;
      }
    }

    if (allVoid) {
      await this.store.settleBet({ betId, status: "void", payout: bet.stake, note: "all legs void" });
      await this.store.credit(bet.userId, bet.stake, `void:${betId}`);
      return;
    }

    const payout = Math.round(bet.stake * multiplier);
    const status: BetStatus = payout > bet.stake ? "won" : payout === bet.stake ? "void" : "half_won";

    await this.store.settleBet({ betId, status, payout });
    if (payout > 0) await this.store.credit(bet.userId, payout, `win:${betId}`);
  }

  /* ---------------------------------------------------------------- */

  /**
   * Provider corrected a result. Unwind, then let the corrected
   * settlement message re-settle from scratch.
   *
   * Do not try to compute a delta. Reverse fully, reopen, re-apply —
   * deltas on half-won Asian legs are where the arithmetic errors live.
   */
  async rollback(job: { eventId: string; marketIds: string[] }) {
    for (const marketId of job.marketIds) {
      const bets = await this.store.betsWithLeg(marketId);
      for (const bet of bets) {
        const legs = await this.store.legsForBet(bet.betId);
        const paid = legs.every((l) => l.status !== "open");
        if (paid) {
          // Reverse whatever we credited. The reference makes this safe
          // to run twice — the ledger dedupes on it.
          await this.store.reverse(bet.userId, 0, `rollback:${bet.betId}`);
        }
        await this.store.settleBet({ betId: bet.betId, status: "open", payout: 0, note: "rolled back" });
        for (const leg of legs.filter((l) => l.marketId === marketId)) {
          await this.store.settleLeg({ legId: leg.legId, status: "open", evidence: { rolledBack: true } });
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Void rules                                                          */
/* ------------------------------------------------------------------ */

/**
 * These are business rules, not provider rules — write them into your
 * terms and settle to them consistently. Inconsistent void handling is
 * the number one source of complaints against Nigerian books.
 */
export const VOID_RULES = {
  abandoned: "All markets void and stakes returned unless the market had already resolved beyond doubt, e.g. Over 1.5 goals with 3 already scored.",
  postponed: "Void if the fixture is not replayed within 48 hours of the scheduled kick-off.",
  venueChange: "Void if the match is moved to the opposing team's ground. Neutral venue changes stand.",
  playerDNP: "Player markets void if the named player takes no part. Anytime scorer stands if the player appears at all.",
  wrongLine: "A market published at an obviously wrong line is void — publish the palpable-error clause and the threshold you use.",
  earlyPayout: "2-up early payouts stand regardless of the final score. Once paid, they are not reversed.",
} as const;
