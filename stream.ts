/**
 * INGESTION PIPELINE
 * ------------------
 * Feed → sequence guard → margin engine → suspension engine →
 * Redis price cache → WebSocket fan-out to clients.
 *
 * Three rules this file exists to enforce:
 *   1. Never serve a price from a stale feed. Suspend instead.
 *   2. Every price the client sees carries a version. Placement checks it.
 *   3. A sequence gap is a resync, not a warning to ignore.
 */

import type {
  FeedAdapter, MarketMapping,
} from "./provider";
import type {
  FeedMessage, MarketInstance, MarketStatus, Outcome, SportEvent, SuspendReason,
} from "./types";

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export const CONFIG = {
  /** No heartbeat or update in this window → suspend everything live. */
  staleFeedMs: 8_000,
  /** Auto-resume a suspended market after this if the feed goes quiet. */
  maxSuspensionMs: 120_000,
  /** Overround we target, by market group. Higher = more margin. */
  margin: {
    main: 0.06,
    goals: 0.07,
    handicap: 0.06,
    halves: 0.08,
    combos: 0.10,
    score: 0.14,
    scorers: 0.13,
    team: 0.08,
    corners: 0.09,
    cards: 0.10,
    timing: 0.12,
    method: 0.12,
    specials: 0.12,
    outright: 0.15,
    default: 0.09,
  } as Record<string, number>,
  /** Price moves beyond this trigger a brief suspension before republish. */
  priceMoveSuspendThreshold: 0.15, // 15%
  priceMoveSuspendMs: 2_000,
  /** Max liability per market before we suspend it. In kobo. */
  liabilityCapKobo: 500_000_00,
  /** Floor and ceiling on any published price. */
  minPrice: 1.01,
  maxPrice: 1000,
};

/* ------------------------------------------------------------------ */
/* Ports — swap these for Redis / Postgres / your socket server        */
/* ------------------------------------------------------------------ */

export interface PriceCache {
  /** HSET market:{id} — full market blob. */
  putMarket(m: MarketInstance): Promise<void>;
  getMarket(marketId: string): Promise<MarketInstance | null>;
  putEvent(e: SportEvent): Promise<void>;
  getEvent(eventId: string): Promise<SportEvent | null>;
  /** Last sequence we successfully applied for this event. */
  getSequence(eventId: string): Promise<number>;
  setSequence(eventId: string, seq: number): Promise<void>;
  /** Open liability on a market, in kobo. */
  getLiability(marketId: string): Promise<number>;
}

export interface Broadcaster {
  /** Fan out to every client subscribed to this event's channel. */
  publish(channel: string, payload: unknown): Promise<void>;
}

export interface SettlementQueue {
  enqueue(job: { eventId: string; results: unknown }): Promise<void>;
  enqueueRollback(job: { eventId: string; marketIds: string[] }): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Margin engine                                                       */
/* ------------------------------------------------------------------ */

/**
 * Vendor prices already carry the vendor's margin. We strip it back to
 * fair probabilities, then apply our own — otherwise margin compounds
 * and your prices are uncompetitive without you noticing.
 *
 * Proportional method. For markets with a strong favourite, consider
 * the power or Shin method instead so the longshot is not over-taxed.
 */
export function applyMargin(market: MarketInstance, group: string): MarketInstance {
  const target = CONFIG.margin[group] ?? CONFIG.margin.default;

  const impliedSum = market.outcomes.reduce((s, o) => s + 1 / o.rawPrice, 0);
  if (impliedSum <= 0) return market;

  const outcomes: Outcome[] = market.outcomes.map((o) => {
    const fairProb = (1 / o.rawPrice) / impliedSum;      // normalised, margin removed
    const ourProb = fairProb * (1 + target);              // our margin applied
    const price = clamp(1 / ourProb, CONFIG.minPrice, CONFIG.maxPrice);
    return { ...o, price: round2(price) };
  });

  return {
    ...market,
    outcomes,
    overround: outcomes.reduce((s, o) => s + 1 / o.price, 0),
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ */
/* Suspension engine                                                   */
/* ------------------------------------------------------------------ */

/**
 * Markets suspend on danger, not on goals alone. By the time the goal
 * message arrives the punter watching the stream has known for eight
 * seconds. That gap is where courtsiding money is made.
 *
 * Practical mitigation for a Nigerian operation without a low-latency
 * scout feed: keep in-play accept delay at 4-6 seconds, suspend hard on
 * every provider bet_stop, and cap in-play single stakes.
 */
export class SuspensionEngine {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private cache: PriceCache, private bus: Broadcaster) {}

  async suspend(marketIds: string[], eventId: string, reason: SuspendReason, autoResumeMs?: number) {
    for (const id of marketIds) {
      const m = await this.cache.getMarket(id);
      if (!m || m.status === "closed" || m.status === "settled") continue;

      const next: MarketInstance = {
        ...m,
        status: "suspended",
        suspendedAt: new Date().toISOString(),
        suspendReason: reason,
        updatedAt: new Date().toISOString(),
      };
      await this.cache.putMarket(next);
      await this.bus.publish(`event:${eventId}`, { type: "market_suspended", marketId: id, reason });

      const t = this.timers.get(id);
      if (t) clearTimeout(t);

      const ms = autoResumeMs ?? CONFIG.maxSuspensionMs;
      this.timers.set(id, setTimeout(() => void this.resume(id, eventId), ms));
    }
  }

  async resume(marketId: string, eventId: string) {
    const m = await this.cache.getMarket(marketId);
    if (!m || m.status !== "suspended") return;

    // Only resume if we have a fresh price. A suspended market with a
    // stale price is worse than a closed one.
    const ageMs = Date.now() - new Date(m.updatedAt).getTime();
    if (ageMs > CONFIG.staleFeedMs * 2) {
      await this.cache.putMarket({ ...m, status: "closed" });
      await this.bus.publish(`event:${eventId}`, { type: "market_closed", marketId, reason: "feed_stale" });
      return;
    }

    const next: MarketInstance = {
      ...m, status: "open", suspendedAt: undefined, suspendReason: undefined,
      updatedAt: new Date().toISOString(),
    };
    await this.cache.putMarket(next);
    await this.bus.publish(`event:${eventId}`, { type: "market_open", marketId, outcomes: next.outcomes });
    this.timers.delete(marketId);
  }

  /** Liability check — call after every accepted bet. */
  async checkLiability(marketId: string, eventId: string) {
    const open = await this.cache.getLiability(marketId);
    if (open >= CONFIG.liabilityCapKobo) {
      await this.suspend([marketId], eventId, "liability_limit");
      return false;
    }
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* Pipeline                                                            */
/* ------------------------------------------------------------------ */

export class FeedPipeline {
  private lastMessageAt = Date.now();
  private staleTimer?: ReturnType<typeof setInterval>;
  private groupOf: (key: string) => string;

  constructor(
    private adapter: FeedAdapter,
    private cache: PriceCache,
    private bus: Broadcaster,
    private settlement: SettlementQueue,
    private suspension: SuspensionEngine,
    /** Lookup from markets.ts — key → group, used for margin selection. */
    groupLookup: Record<string, string>,
  ) {
    this.groupOf = (key) => groupLookup[key] ?? "default";
  }

  async start() {
    this.staleTimer = setInterval(() => void this.checkStale(), 2_000);
    await this.adapter.connect((msg) => this.handle(msg));
  }

  async stop() {
    if (this.staleTimer) clearInterval(this.staleTimer);
    await this.adapter.disconnect();
  }

  private async handle(msg: FeedMessage) {
    this.lastMessageAt = Date.now();

    if (msg.type === "heartbeat") return;

    // ---- sequence guard ----
    if ("eventId" in msg && "sequence" in msg) {
      const last = await this.cache.getSequence(msg.eventId);
      if (msg.sequence <= last) return;                     // duplicate or out of order
      if (last > 0 && msg.sequence !== last + 1) {
        // Gap. Do not apply a partial update on top of an unknown state.
        await this.resync(msg.eventId);
        return;
      }
    }

    switch (msg.type) {
      case "snapshot": {
        await this.cache.putEvent(msg.event);
        for (const m of msg.markets) await this.storeMarket(m);
        await this.cache.setSequence(msg.event.id, msg.event.sequence);
        await this.bus.publish(`event:${msg.event.id}`, { type: "snapshot", event: msg.event });
        break;
      }

      case "odds_change": {
        for (const incoming of msg.markets) {
          const prev = await this.cache.getMarket(incoming.id);
          const priced = await this.storeMarket(incoming);

          // Sharp move → brief suspend so we do not get picked off mid-move.
          if (prev && movedSharply(prev, priced)) {
            await this.suspension.suspend(
              [priced.id], msg.eventId, "price_move", CONFIG.priceMoveSuspendMs
            );
            continue;
          }

          await this.bus.publish(`event:${msg.eventId}`, {
            type: "odds",
            marketId: priced.id,
            status: priced.status,
            outcomes: priced.outcomes.map((o) => ({
              id: o.id, label: o.label, price: o.price, version: o.version,
            })),
          });
        }
        await this.cache.setSequence(msg.eventId, msg.sequence);
        break;
      }

      case "market_status": {
        if (msg.status === "suspended") {
          await this.suspension.suspend(msg.marketIds, msg.eventId, msg.reason ?? "provider_suspend");
        } else {
          for (const id of msg.marketIds) {
            const m = await this.cache.getMarket(id);
            if (m) await this.cache.putMarket({ ...m, status: msg.status, updatedAt: new Date().toISOString() });
          }
          await this.bus.publish(`event:${msg.eventId}`, {
            type: "market_status", marketIds: msg.marketIds, status: msg.status,
          });
        }
        await this.cache.setSequence(msg.eventId, msg.sequence);
        break;
      }

      case "event_change": {
        const ev = await this.cache.getEvent(msg.eventId);
        if (ev) await this.cache.putEvent({ ...ev, ...msg.patch, sequence: msg.sequence });
        await this.cache.setSequence(msg.eventId, msg.sequence);
        await this.bus.publish(`event:${msg.eventId}`, { type: "event", patch: msg.patch });
        break;
      }

      case "settlement": {
        await this.settlement.enqueue({ eventId: msg.eventId, results: msg.results });
        await this.cache.setSequence(msg.eventId, msg.sequence);
        break;
      }

      case "rollback": {
        // Provider corrected a result. Reverse the payouts, then re-settle.
        await this.settlement.enqueueRollback({ eventId: msg.eventId, marketIds: msg.marketIds });
        await this.cache.setSequence(msg.eventId, msg.sequence);
        break;
      }
    }
  }

  private async storeMarket(m: MarketInstance): Promise<MarketInstance> {
    const group = this.groupOf(m.key);
    const priced = applyMargin({ ...m, group }, group);
    await this.cache.putMarket(priced);
    return priced;
  }

  private async resync(eventId: string) {
    const { event, markets } = await this.adapter.snapshot(eventId);
    await this.cache.putEvent(event);
    for (const m of markets) await this.storeMarket(m);
    await this.cache.setSequence(eventId, event.sequence);
    await this.bus.publish(`event:${eventId}`, { type: "resync", event });
  }

  private async checkStale() {
    if (Date.now() - this.lastMessageAt < CONFIG.staleFeedMs) return;
    // Feed has gone quiet. Suspend rather than serve prices we cannot trust.
    await this.bus.publish("system", { type: "feed_stale", since: this.lastMessageAt });
  }
}

function movedSharply(prev: MarketInstance, next: MarketInstance): boolean {
  for (const n of next.outcomes) {
    const p = prev.outcomes.find((x) => x.id === n.id);
    if (!p) continue;
    const delta = Math.abs(n.price - p.price) / p.price;
    if (delta > CONFIG.priceMoveSuspendThreshold) return true;
  }
  return false;
}
