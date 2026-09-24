/**
 * BET PLACEMENT
 * -------------
 * The moment where a stale price costs you real naira. Everything here
 * runs inside one database transaction, and the whole call is
 * idempotent on `idempotencyKey` — mobile networks in Nigeria will
 * retry the same POST three times and you must not take three bets.
 */

import type {
  AcceptedBet, BetRejection, BetRequest, MarketInstance, Selection,
} from "./types";
import type { PriceCache, SuspensionEngine } from "./stream";

export const LIMITS = {
  minStakeKobo: 100_00,          // ₦100
  maxStakeSingleKobo: 500_000_00, // ₦500,000
  maxLegs: 30,
  maxPotentialReturnKobo: 100_000_000_00, // ₦100m payout cap
  /** In-play bets are held before acceptance. Kills most courtsiding. */
  inPlayAcceptDelayMs: 5_000,
};

export interface Ledger {
  /** Returns null if the key was already used — replay the stored bet. */
  findByIdempotencyKey(key: string): Promise<AcceptedBet | null>;
  balance(userId: string): Promise<number>;
  /** Debit + insert bet + insert legs, atomically. */
  commitBet(args: {
    idempotencyKey: string;
    userId: string;
    stake: number;
    totalOdds: number;
    potentialReturn: number;
    legs: { marketId: string; outcomeId: string; price: number }[];
    betType: BetRequest["betType"];
  }): Promise<AcceptedBet>;
  isSelfExcluded(userId: string): Promise<boolean>;
}

/**
 * Legs that cannot appear on the same accumulator because one implies
 * the other. Correlated legs on a straight multiple is the single most
 * common way a new book gets arbitraged in its first month.
 *
 * Genuine same-match combinations must go through the bet-builder
 * pricer, which prices them jointly rather than multiplying.
 */
const CORRELATION_RULES: [string, string][] = [
  ["1x2", "dc"],
  ["1x2", "dnb"],
  ["1x2", "ah"],
  ["1x2", "eh"],
  ["1x2", "correct_score"],
  ["1x2", "ht_ft"],
  ["1x2", "winning_margin"],
  ["dc", "dnb"],
  ["ou_goals", "correct_score"],
  ["ou_goals", "goal_range"],
  ["ou_goals", "exact_goals"],
  ["ou_goals", "multigoal"],
  ["btts", "correct_score"],
  ["btts", "clean_sheet"],
  ["btts", "win_to_nil"],
  ["team_ou", "correct_score"],
  ["1x2_btts", "1x2"],
  ["1x2_btts", "btts"],
  ["1x2_ou", "1x2"],
  ["1x2_ou", "ou_goals"],
];

const correlated = (a: string, b: string) =>
  CORRELATION_RULES.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

export class PlacementService {
  constructor(
    private cache: PriceCache,
    private ledger: Ledger,
    private suspension: SuspensionEngine,
  ) {}

  async place(req: BetRequest): Promise<
    { ok: true; bet: AcceptedBet } | { ok: false; rejections: BetRejection[] }
  > {
    /* ---- 0. idempotency ---- */
    const existing = await this.ledger.findByIdempotencyKey(req.idempotencyKey);
    if (existing) return { ok: true, bet: existing };

    const rejections: BetRejection[] = [];

    /* ---- 1. account state ---- */
    if (await this.ledger.isSelfExcluded(req.userId)) {
      return { ok: false, rejections: [{ code: "self_excluded" }] };
    }

    /* ---- 2. stake bounds ---- */
    if (req.stake < LIMITS.minStakeKobo) {
      rejections.push({ code: "stake_below_min", min: LIMITS.minStakeKobo });
    }
    if (req.stake > LIMITS.maxStakeSingleKobo) {
      rejections.push({ code: "stake_above_max", max: LIMITS.maxStakeSingleKobo });
    }

    /* ---- 3. load and verify every leg ---- */
    const verified: { sel: Selection; market: MarketInstance; price: number }[] = [];
    const seenMarkets = new Set<string>();
    const byEvent = new Map<string, string[]>(); // eventId → market keys

    for (const sel of req.selections) {
      const market = await this.cache.getMarket(sel.marketId);

      if (!market) {
        rejections.push({ code: "market_closed", marketId: sel.marketId });
        continue;
      }
      if (market.status === "suspended") {
        rejections.push({ code: "market_suspended", marketId: sel.marketId });
        continue;
      }
      if (market.status !== "open") {
        rejections.push({ code: "market_closed", marketId: sel.marketId });
        continue;
      }
      if (seenMarkets.has(market.id)) {
        rejections.push({ code: "duplicate_market", marketId: market.id });
        continue;
      }
      seenMarkets.add(market.id);

      const outcome = market.outcomes.find((o) => o.id === sel.outcomeId);
      if (!outcome || outcome.status !== "open") {
        rejections.push({ code: "market_closed", marketId: market.id });
        continue;
      }

      /* ---- price check ---- */
      const moved = outcome.version !== sel.quotedVersion || outcome.price !== sel.quotedPrice;
      if (moved) {
        const drifted = this.priceAcceptable(req.priceChangePolicy, sel.quotedPrice, outcome.price);
        if (!drifted) {
          rejections.push({ code: "price_changed", marketId: market.id, was: sel.quotedPrice, now: outcome.price });
          continue;
        }
      }

      /* ---- staleness ---- */
      const ageMs = Date.now() - new Date(market.updatedAt).getTime();
      const event = await this.cache.getEvent(market.eventId);
      if (event?.status === "live" && ageMs > 10_000) {
        rejections.push({ code: "stale_feed", eventId: market.eventId });
        continue;
      }
      if (event && event.status !== "live" && new Date(event.startsAt).getTime() <= Date.now()) {
        rejections.push({ code: "event_started", eventId: event.id });
        continue;
      }

      const keys = byEvent.get(market.eventId) ?? [];
      keys.push(market.key);
      byEvent.set(market.eventId, keys);

      verified.push({ sel, market, price: outcome.price });
    }

    /* ---- 4. correlation ---- */
    if (req.betType !== "builder") {
      for (const [eventId, keys] of byEvent) {
        for (let i = 0; i < keys.length; i++) {
          for (let j = i + 1; j < keys.length; j++) {
            if (correlated(keys[i], keys[j])) {
              rejections.push({
                code: "correlated_legs",
                marketIds: [`${eventId}:${keys[i]}`, `${eventId}:${keys[j]}`],
              });
            }
          }
        }
      }
    }

    if (verified.length > LIMITS.maxLegs) {
      rejections.push({ code: "stake_above_max", max: LIMITS.maxLegs });
    }

    if (rejections.length) return { ok: false, rejections };

    /* ---- 5. price the ticket ---- */
    const totalOdds = req.betType === "builder"
      ? this.priceBuilder(verified.map((v) => v.price))
      : verified.reduce((a, v) => a * v.price, 1);

    const potentialReturn = Math.round(req.stake * totalOdds);

    if (potentialReturn > LIMITS.maxPotentialReturnKobo) {
      return { ok: false, rejections: [{ code: "stake_above_max", max: LIMITS.maxPotentialReturnKobo }] };
    }

    /* ---- 6. funds ---- */
    const balance = await this.ledger.balance(req.userId);
    if (balance < req.stake) {
      return { ok: false, rejections: [{ code: "insufficient_funds", shortfall: req.stake - balance }] };
    }

    /* ---- 7. in-play hold ---- */
    const anyLive = await this.anyLive(verified.map((v) => v.market.eventId));
    if (anyLive) {
      await sleep(LIMITS.inPlayAcceptDelayMs);
      // Re-verify after the hold — a goal may have landed during it.
      for (const v of verified) {
        const fresh = await this.cache.getMarket(v.market.id);
        if (!fresh || fresh.status !== "open") {
          return { ok: false, rejections: [{ code: "market_suspended", marketId: v.market.id }] };
        }
        const o = fresh.outcomes.find((x) => x.id === v.sel.outcomeId);
        if (!o || !this.priceAcceptable(req.priceChangePolicy, v.price, o.price)) {
          return { ok: false, rejections: [{ code: "price_changed", marketId: v.market.id, was: v.price, now: o?.price ?? 0 }] };
        }
      }
    }

    /* ---- 8. commit ---- */
    const bet = await this.ledger.commitBet({
      idempotencyKey: req.idempotencyKey,
      userId: req.userId,
      stake: req.stake,
      totalOdds,
      potentialReturn,
      legs: verified.map((v) => ({ marketId: v.market.id, outcomeId: v.sel.outcomeId, price: v.price })),
      betType: req.betType,
    });

    /* ---- 9. liability, post-commit ---- */
    for (const v of verified) {
      await this.suspension.checkLiability(v.market.id, v.market.eventId);
    }

    return { ok: true, bet };
  }

  private priceAcceptable(policy: BetRequest["priceChangePolicy"], quoted: number, live: number) {
    if (policy === "accept_any") return true;
    if (policy === "accept_higher") return live >= quoted;
    return live === quoted;
  }

  /**
   * Same-match legs are correlated, so multiplying overstates the price.
   * This is a conservative placeholder: a real bet-builder pricer runs a
   * joint model or a copula over leg probabilities. Ship the haircut
   * version first — an underpriced builder is a standing invitation.
   */
  private priceBuilder(prices: number[]): number {
    const naive = prices.reduce((a, p) => a * p, 1);
    const haircut = Math.pow(0.88, Math.max(0, prices.length - 1));
    return Math.max(1.01, Math.round(naive * haircut * 100) / 100);
  }

  private async anyLive(eventIds: string[]) {
    for (const id of new Set(eventIds)) {
      const e = await this.cache.getEvent(id);
      if (e?.status === "live") return true;
    }
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
