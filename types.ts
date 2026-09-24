/**
 * ODDS FEED — DOMAIN TYPES
 * ------------------------
 * Provider-agnostic. Nothing here knows about Sportradar, BetsAPI or
 * The Odds API. Adapters translate into these shapes; everything
 * downstream (pricing, slip, settlement) speaks only this vocabulary.
 */

export type EventStatus =
  | "scheduled"
  | "live"
  | "halftime"
  | "suspended"   // whole event frozen (VAR, feed loss, manual)
  | "ended"
  | "postponed"
  | "abandoned"
  | "cancelled";

export type MarketStatus =
  | "open"
  | "suspended"   // temporary, prices will return
  | "closed"      // no more bets, awaiting result
  | "settled"
  | "voided";

export type OutcomeStatus = "open" | "won" | "lost" | "void" | "half_won" | "half_lost";

export interface Competitor {
  id: string;
  name: string;
  side: "home" | "away";
  abbreviation?: string;
}

export interface SportEvent {
  id: string;                 // our ID
  providerId: string;
  provider: ProviderName;
  sport: "football" | "basketball" | "tennis";
  competitionId: string;
  competitionName: string;
  competitors: Competitor[];
  startsAt: string;           // ISO
  status: EventStatus;
  /** Live match state used by the suspension engine and cash-out. */
  clock?: { minute: number; period: "1H" | "2H" | "ET" | "PENS" };
  score?: { home: number; away: number };
  /** Monotonic per event. Gaps mean a missed message — resync. */
  sequence: number;
  updatedAt: string;
}

export interface Outcome {
  /** Stable within the market. Composite of market key + label. */
  id: string;
  label: string;
  /** True (fair) probability before margin, 0-1. */
  probability?: number;
  /** Price we display and honour. Already includes our margin. */
  price: number;
  /** Raw provider price before our margin. Kept for audit. */
  rawPrice: number;
  status: OutcomeStatus;
  /** Bumps on every price change. Placement checks this. */
  version: number;
}

export interface MarketInstance {
  id: string;                 // `${eventId}:${key}:${lineKey}`
  eventId: string;
  key: string;                // canonical key from markets.ts, e.g. "ou_goals"
  name: string;
  group: string;
  line?: number;
  status: MarketStatus;
  outcomes: Outcome[];
  /** Sum of implied probabilities. 1.06 = 6% overround. */
  overround: number;
  cashoutEnabled: boolean;
  /** Set when suspended so we can auto-resume after a timeout. */
  suspendedAt?: string;
  suspendReason?: SuspendReason;
  sequence: number;
  updatedAt: string;
}

export type SuspendReason =
  | "goal"
  | "red_card"
  | "penalty"
  | "var"
  | "corner_danger"
  | "provider_suspend"
  | "feed_stale"
  | "liability_limit"
  | "manual"
  | "price_move";

export type ProviderName = "sportradar" | "betsapi" | "oddsapi" | "internal";

/* ------------------------------------------------------------------ */
/* Feed messages                                                       */
/* ------------------------------------------------------------------ */

export type FeedMessage =
  | { type: "snapshot"; event: SportEvent; markets: MarketInstance[] }
  | { type: "odds_change"; eventId: string; sequence: number; markets: MarketInstance[] }
  | { type: "event_change"; eventId: string; sequence: number; patch: Partial<SportEvent> }
  | { type: "market_status"; eventId: string; sequence: number; marketIds: string[]; status: MarketStatus; reason?: SuspendReason }
  | { type: "settlement"; eventId: string; sequence: number; results: MarketResult[] }
  | { type: "rollback"; eventId: string; sequence: number; marketIds: string[]; note: string }
  | { type: "heartbeat"; at: string };

export interface MarketResult {
  marketId: string;
  marketKey: string;
  outcomes: { outcomeId: string; status: OutcomeStatus }[];
  /** Raw stats the resolver used. Stored for dispute handling. */
  evidence: Record<string, number | string>;
  settledAt: string;
}

/* ------------------------------------------------------------------ */
/* Betting types                                                       */
/* ------------------------------------------------------------------ */

export interface Selection {
  marketId: string;
  outcomeId: string;
  /** Price the punter saw. Compared against live price at placement. */
  quotedPrice: number;
  quotedVersion: number;
}

export type PriceChangePolicy = "reject" | "accept_higher" | "accept_any";

export interface BetRequest {
  idempotencyKey: string;
  userId: string;
  stake: number;              // kobo, integer
  currency: "NGN";
  selections: Selection[];
  betType: "single" | "multiple" | "system" | "builder";
  systemSize?: number;
  priceChangePolicy: PriceChangePolicy;
  bookingCode?: string;
}

export type BetRejection =
  | { code: "market_suspended"; marketId: string }
  | { code: "market_closed"; marketId: string }
  | { code: "price_changed"; marketId: string; was: number; now: number }
  | { code: "stake_below_min"; min: number }
  | { code: "stake_above_max"; max: number }
  | { code: "insufficient_funds"; shortfall: number }
  | { code: "liability_exceeded"; marketId: string }
  | { code: "duplicate_market"; marketId: string }
  | { code: "correlated_legs"; marketIds: string[] }
  | { code: "event_started"; eventId: string }
  | { code: "self_excluded" }
  | { code: "stale_feed"; eventId: string };

export interface AcceptedBet {
  betId: string;
  totalOdds: number;
  stake: number;
  potentialReturn: number;
  acceptedPrices: { outcomeId: string; price: number }[];
  placedAt: string;
}
