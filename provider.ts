/**
 * PROVIDER ADAPTERS
 * -----------------
 * One adapter per feed vendor. The adapter is the ONLY place that knows
 * vendor market IDs, vendor status codes and vendor transport.
 *
 * Swapping vendor = writing one adapter + one mapping table.
 * Nothing else in the codebase changes.
 *
 * Practical note for a Nigerian build: start on BetsAPI or The Odds API
 * (cheap, REST-friendly, no minimum spend), keep the adapter boundary
 * clean, and move to Sportradar or Betradar when you are licensed and
 * the volume justifies the contract. Do not let vendor shapes leak.
 */

import type {
  FeedMessage, MarketInstance, MarketStatus, Outcome, ProviderName,
  SportEvent, SuspendReason,
} from "./types";

export interface FeedAdapter {
  name: ProviderName;
  /** Long-lived stream. Must reconnect internally and emit a snapshot on resync. */
  connect(handler: (msg: FeedMessage) => void | Promise<void>): Promise<void>;
  disconnect(): Promise<void>;
  /** Pull a full snapshot — used on gap detection and cold start. */
  snapshot(eventId: string): Promise<{ event: SportEvent; markets: MarketInstance[] }>;
  /** Fixtures for the next N hours, for the pre-match cache. */
  fixtures(fromISO: string, toISO: string): Promise<SportEvent[]>;
}

/* ================================================================== */
/* Market ID mapping                                                   */
/* ================================================================== */

/**
 * Maps vendor market IDs to our canonical keys from markets.ts.
 * `specifier` handles vendor line encoding, e.g. Sportradar sends
 * total=2.5 as a specifier string rather than a separate market.
 *
 * Anything not in this table is DROPPED, not guessed. An unmapped
 * market silently priced is how you end up settling a bet you cannot
 * defend in a dispute.
 */
export interface MarketMapping {
  providerMarketId: string;
  key: string;
  /** Extracts the numeric line from the vendor specifier blob. */
  line?: (spec: Record<string, string>) => number | undefined;
  /** Maps vendor outcome IDs to our labels. */
  outcomes: Record<string, string>;
}

export const SPORTRADAR_FOOTBALL_MAP: MarketMapping[] = [
  {
    providerMarketId: "1",
    key: "1x2",
    outcomes: { "1": "1", "2": "X", "3": "2" },
  },
  {
    providerMarketId: "10",
    key: "dc",
    outcomes: { "9": "1X", "10": "12", "11": "X2" },
  },
  {
    providerMarketId: "11",
    key: "dnb",
    outcomes: { "4": "1", "5": "2" },
  },
  {
    providerMarketId: "18",
    key: "ou_goals",
    line: (s) => Number(s.total),
    outcomes: { "12": "Over", "13": "Under" },
  },
  {
    providerMarketId: "29",
    key: "btts",
    outcomes: { "74": "Yes", "76": "No" },
  },
  {
    providerMarketId: "16",
    key: "ah",
    line: (s) => Number(s.hcp),
    outcomes: { "1714": "Home", "1715": "Away" },
  },
  {
    providerMarketId: "14",
    key: "eh",
    line: (s) => Number(s.hcp),
    outcomes: { "1711": "1", "1712": "X", "1713": "2" },
  },
  {
    providerMarketId: "45",
    key: "1x2_1h",
    outcomes: { "1": "1", "2": "X", "3": "2" },
  },
  {
    providerMarketId: "68",
    key: "ou_goals_1h",
    line: (s) => Number(s.total),
    outcomes: { "12": "Over", "13": "Under" },
  },
  {
    providerMarketId: "7",
    key: "ht_ft",
    outcomes: {
      "6": "1/1", "7": "1/X", "8": "1/2",
      "9": "X/1", "10": "X/X", "11": "X/2",
      "12": "2/1", "13": "2/X", "14": "2/2",
    },
  },
  {
    providerMarketId: "45",
    key: "correct_score",
    outcomes: {}, // dynamic — outcome label is the scoreline from the specifier
  },
  {
    providerMarketId: "166",
    key: "corners_ou",
    line: (s) => Number(s.total),
    outcomes: { "12": "Over", "13": "Under" },
  },
  {
    providerMarketId: "225",
    key: "cards_ou",
    line: (s) => Number(s.total),
    outcomes: { "12": "Over", "13": "Under" },
  },
  {
    providerMarketId: "38",
    key: "anytime_scorer",
    outcomes: {}, // dynamic — player ID resolved from the squad payload
  },
];

const mapIndex = new Map(SPORTRADAR_FOOTBALL_MAP.map((m) => [m.providerMarketId, m]));

/* ================================================================== */
/* Vendor status translation                                           */
/* ================================================================== */

const SR_MARKET_STATUS: Record<string, MarketStatus> = {
  "0": "open",
  "-1": "suspended",
  "-2": "closed",
  "-3": "settled",
  "-4": "voided",
};

const SR_SUSPEND_REASON: Record<string, SuspendReason> = {
  goal: "goal",
  red_card: "red_card",
  penalty: "penalty",
  video_assistant_referee: "var",
};

/* ================================================================== */
/* Sportradar adapter                                                  */
/* ================================================================== */

interface SportradarConfig {
  wsUrl: string;
  apiUrl: string;
  apiKey: string;
  /** Our margin, applied per market group. See pricing in stream.ts. */
  onError?: (e: Error) => void;
}

export class SportradarAdapter implements FeedAdapter {
  name: ProviderName = "sportradar";
  private ws?: WebSocket;
  private closing = false;
  private backoff = 1000;

  constructor(private cfg: SportradarConfig) {}

  async connect(handler: (msg: FeedMessage) => void | Promise<void>) {
    const open = () => {
      this.ws = new WebSocket(`${this.cfg.wsUrl}?key=${this.cfg.apiKey}`);

      this.ws.onopen = () => {
        this.backoff = 1000;
      };

      this.ws.onmessage = async (ev) => {
        try {
          const raw = JSON.parse(String(ev.data));
          const msg = this.translate(raw);
          if (msg) await handler(msg);
        } catch (e) {
          this.cfg.onError?.(e as Error);
        }
      };

      this.ws.onclose = () => {
        if (this.closing) return;
        // Exponential backoff, capped. On reconnect the pipeline will
        // detect a sequence gap and pull fresh snapshots itself.
        setTimeout(open, this.backoff);
        this.backoff = Math.min(this.backoff * 2, 30_000);
      };

      this.ws.onerror = () => this.ws?.close();
    };

    open();
  }

  async disconnect() {
    this.closing = true;
    this.ws?.close();
  }

  async snapshot(eventId: string) {
    const res = await fetch(`${this.cfg.apiUrl}/events/${eventId}/markets`, {
      headers: { "x-api-key": this.cfg.apiKey },
    });
    if (!res.ok) throw new Error(`snapshot ${eventId} failed: ${res.status}`);
    const raw = await res.json();
    return {
      event: this.translateEvent(raw.sport_event, raw.sequence ?? 0),
      markets: this.translateMarkets(raw.sport_event.id, raw.markets ?? [], raw.sequence ?? 0),
    };
  }

  async fixtures(fromISO: string, toISO: string) {
    const res = await fetch(
      `${this.cfg.apiUrl}/schedules?start=${fromISO}&end=${toISO}`,
      { headers: { "x-api-key": this.cfg.apiKey } }
    );
    if (!res.ok) throw new Error(`fixtures failed: ${res.status}`);
    const raw = await res.json();
    return (raw.sport_events ?? []).map((e: any) => this.translateEvent(e, 0));
  }

  /* ---------------- translation ---------------- */

  private translate(raw: any): FeedMessage | null {
    switch (raw.type) {
      case "odds_change":
        return {
          type: "odds_change",
          eventId: raw.event_id,
          sequence: raw.sequence,
          markets: this.translateMarkets(raw.event_id, raw.markets ?? [], raw.sequence),
        };
      case "bet_stop":
        return {
          type: "market_status",
          eventId: raw.event_id,
          sequence: raw.sequence,
          marketIds: raw.market_ids ?? [],
          status: "suspended",
          reason: SR_SUSPEND_REASON[raw.reason] ?? "provider_suspend",
        };
      case "bet_settlement":
        return {
          type: "settlement",
          eventId: raw.event_id,
          sequence: raw.sequence,
          results: (raw.markets ?? []).map((m: any) => ({
            marketId: `${raw.event_id}:${mapIndex.get(String(m.id))?.key ?? m.id}`,
            marketKey: mapIndex.get(String(m.id))?.key ?? String(m.id),
            outcomes: (m.outcomes ?? []).map((o: any) => ({
              outcomeId: o.id,
              status: o.result === "1" ? "won" : o.result === "0" ? "lost"
                : o.result === "-1" ? "void"
                : o.result === "0.5" ? "half_won" : "half_lost",
            })),
            evidence: m.evidence ?? {},
            settledAt: new Date().toISOString(),
          })),
        };
      case "rollback_bet_settlement":
        return {
          type: "rollback",
          eventId: raw.event_id,
          sequence: raw.sequence,
          marketIds: raw.market_ids ?? [],
          note: "provider rolled back settlement",
        };
      case "alive":
        return { type: "heartbeat", at: new Date().toISOString() };
      default:
        return null;
    }
  }

  private translateEvent(e: any, sequence: number): SportEvent {
    return {
      id: e.id,
      providerId: e.id,
      provider: "sportradar",
      sport: "football",
      competitionId: e.tournament?.id ?? "",
      competitionName: e.tournament?.name ?? "",
      competitors: (e.competitors ?? []).map((c: any) => ({
        id: c.id, name: c.name, side: c.qualifier, abbreviation: c.abbreviation,
      })),
      startsAt: e.scheduled,
      status: e.status === "live" ? "live" : e.status === "closed" ? "ended" : "scheduled",
      clock: e.sport_event_status?.clock
        ? { minute: Number(e.sport_event_status.clock.match_time ?? 0), period: "1H" }
        : undefined,
      score: e.sport_event_status
        ? { home: e.sport_event_status.home_score ?? 0, away: e.sport_event_status.away_score ?? 0 }
        : undefined,
      sequence,
      updatedAt: new Date().toISOString(),
    };
  }

  private translateMarkets(eventId: string, raw: any[], sequence: number): MarketInstance[] {
    const out: MarketInstance[] = [];

    for (const m of raw) {
      const mapping = mapIndex.get(String(m.id));
      if (!mapping) continue; // unmapped markets are dropped, never guessed

      const spec: Record<string, string> = Object.fromEntries(
        String(m.specifiers ?? "").split("|").filter(Boolean).map((p) => p.split("=") as [string, string])
      );
      const line = mapping.line?.(spec);
      const lineKey = line === undefined ? "" : `:${line}`;

      const outcomes: Outcome[] = (m.outcomes ?? [])
        .map((o: any): Outcome | null => {
          const label = mapping.outcomes[String(o.id)] ?? o.name;
          if (!label) return null;
          const price = Number(o.odds);
          if (!Number.isFinite(price) || price <= 1) return null;
          return {
            id: `${eventId}:${mapping.key}${lineKey}:${label}`,
            label,
            probability: o.probabilities ? Number(o.probabilities) : undefined,
            price,
            rawPrice: price,
            status: "open",
            version: sequence,
          };
        })
        .filter(Boolean) as Outcome[];

      if (!outcomes.length) continue;

      const overround = outcomes.reduce((s, o) => s + 1 / o.price, 0);

      out.push({
        id: `${eventId}:${mapping.key}${lineKey}`,
        eventId,
        key: mapping.key,
        name: mapping.key,
        group: "",           // filled from markets.ts catalogue downstream
        line,
        status: SR_MARKET_STATUS[String(m.status)] ?? "open",
        outcomes,
        overround,
        cashoutEnabled: true,
        sequence,
        updatedAt: new Date().toISOString(),
      });
    }

    return out;
  }
}
