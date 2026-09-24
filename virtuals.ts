/**
 * VIRTUALS AND JACKPOTS
 * ---------------------
 * Virtuals are the revenue floor. Real football stops; virtuals run a
 * fixture every three minutes, all night, at a fixed and known margin.
 * For most Nigerian books they are a large share of turnover.
 *
 * Because outcomes are generated rather than observed, the integrity
 * burden is entirely on you. This implementation is provably fair:
 * the server commits to a seed hash BEFORE the round, reveals the seed
 * after, and anyone can recompute the result. If you skip this, you
 * have no answer when a punter says the round was rigged — and in this
 * market that accusation spreads fast.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";

/* ================================================================== */
/* Provably fair RNG                                                   */
/* ================================================================== */

export interface RoundSeed {
  roundId: string;
  /** Published BEFORE the round. Proves we did not pick after seeing bets. */
  serverSeedHash: string;
  /** Revealed AFTER settlement. */
  serverSeed?: string;
  /** Contributed by the client or derived from a public source. */
  clientSeed: string;
  nonce: number;
}

export class ProvablyFairRng {
  /** Call at round creation. Store the seed, publish only the hash. */
  static commit(roundId: string, clientSeed: string): { seed: string; commitment: RoundSeed } {
    const seed = randomBytes(32).toString("hex");
    return {
      seed,
      commitment: {
        roundId,
        serverSeedHash: createHash("sha256").update(seed).digest("hex"),
        clientSeed,
        nonce: 0,
      },
    };
  }

  /**
   * Deterministic stream of floats in [0,1). Same seed + client seed +
   * nonce always yields the same sequence, which is what makes the
   * result verifiable after the fact.
   */
  static *stream(serverSeed: string, clientSeed: string, startNonce = 0): Generator<number> {
    let nonce = startNonce;
    for (;;) {
      const hmac = createHmac("sha256", serverSeed)
        .update(`${clientSeed}:${nonce}`)
        .digest();
      // Four floats per hash — cheaper than rehashing for each draw.
      for (let i = 0; i < 4; i++) {
        const slice = hmac.readUInt32BE(i * 4);
        yield slice / 0x1_0000_0000;
      }
      nonce++;
    }
  }

  /** Anyone can run this against the published seed and hash. */
  static verify(commitment: RoundSeed, revealedSeed: string): boolean {
    return createHash("sha256").update(revealedSeed).digest("hex") === commitment.serverSeedHash;
  }
}

/* ================================================================== */
/* Virtual football                                                    */
/* ================================================================== */

export interface VirtualTeam {
  id: string;
  name: string;
  /** Attack and defence ratings drive the simulation. */
  attack: number;
  defence: number;
}

export interface VirtualFixture {
  id: string;
  roundId: string;
  home: VirtualTeam;
  away: VirtualTeam;
  kickoffAt: string;
}

export interface VirtualResult {
  fixtureId: string;
  homeGoals: number;
  awayGoals: number;
  /** Minute of each goal, for the in-play animation and timing markets. */
  goalMinutes: { minute: number; side: "home" | "away" }[];
  corners: { home: number; away: number };
  cards: { home: number; away: number };
  /** Everything needed to recompute this result independently. */
  proof: { serverSeed: string; clientSeed: string; nonce: number };
}

/**
 * The target margin is set here and nowhere else. Everything about the
 * simulation is calibrated so that, priced with `VIRTUAL_MARGIN`, the
 * book returns that margin over a large number of rounds.
 *
 * Publish the RTP. Punters who can see 94% will play; punters who
 * suspect 70% and cannot check will leave.
 */
export const VIRTUAL_MARGIN = 0.06;   // ~94% RTP
export const HOME_ADVANTAGE = 1.15;
export const BASE_GOAL_RATE = 1.35;

export function simulateFixture(
  fixture: VirtualFixture,
  serverSeed: string,
  clientSeed: string,
  nonce: number
): VirtualResult {
  const rng = ProvablyFairRng.stream(serverSeed, `${clientSeed}:${fixture.id}`, nonce);
  const next = () => rng.next().value as number;

  const lambdaHome =
    BASE_GOAL_RATE * HOME_ADVANTAGE * (fixture.home.attack / fixture.away.defence);
  const lambdaAway =
    BASE_GOAL_RATE * (fixture.away.attack / fixture.home.defence);

  const homeGoals = poissonDraw(lambdaHome, next);
  const awayGoals = poissonDraw(lambdaAway, next);

  const goalMinutes: VirtualResult["goalMinutes"] = [];
  for (let i = 0; i < homeGoals; i++) goalMinutes.push({ minute: 1 + Math.floor(next() * 90), side: "home" });
  for (let i = 0; i < awayGoals; i++) goalMinutes.push({ minute: 1 + Math.floor(next() * 90), side: "away" });
  goalMinutes.sort((a, b) => a.minute - b.minute);

  // Corners and cards correlate with the goal process, same as real
  // football — open games generate corners, tight ones generate cards.
  const openness = (lambdaHome + lambdaAway) / (2 * BASE_GOAL_RATE);
  const corners = {
    home: poissonDraw(5.1 * openness, next),
    away: poissonDraw(4.3 * openness, next),
  };
  const cards = {
    home: poissonDraw(2.1 / Math.max(0.6, openness), next),
    away: poissonDraw(2.3 / Math.max(0.6, openness), next),
  };

  return {
    fixtureId: fixture.id,
    homeGoals, awayGoals, goalMinutes, corners, cards,
    proof: { serverSeed, clientSeed, nonce },
  };
}

/** Knuth's method. Fine for the small means football produces. */
function poissonDraw(lambda: number, next: () => number): number {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= next(); } while (p > L && k < 30);
  return k - 1;
}

/* ------------------------------------------------------------------ */
/* Pricing virtuals                                                    */
/* ------------------------------------------------------------------ */

/**
 * Because we own the model, virtual prices come from the true
 * probabilities directly — no feed, no fitting. Run a Monte Carlo once
 * per fixture definition and cache; the ratings do not change between
 * rounds, so the same matchup always prices identically.
 */
export function priceVirtual(fixture: VirtualFixture, simulations = 100_000): Record<string, number> {
  const lambdaHome = BASE_GOAL_RATE * HOME_ADVANTAGE * (fixture.home.attack / fixture.away.defence);
  const lambdaAway = BASE_GOAL_RATE * (fixture.away.attack / fixture.home.defence);

  let h = 0, d = 0, a = 0, over25 = 0, btts = 0;
  const rng = ProvablyFairRng.stream("pricing", fixture.id, 0);
  const next = () => rng.next().value as number;

  for (let i = 0; i < simulations; i++) {
    const hg = poissonDraw(lambdaHome, next);
    const ag = poissonDraw(lambdaAway, next);
    if (hg > ag) h++; else if (hg === ag) d++; else a++;
    if (hg + ag > 2.5) over25++;
    if (hg > 0 && ag > 0) btts++;
  }

  const price = (wins: number) => {
    const p = wins / simulations;
    return p <= 0 ? 999 : round2(Math.max(1.01, (1 / p) * (1 - VIRTUAL_MARGIN)));
  };

  return {
    "1": price(h),
    "X": price(d),
    "2": price(a),
    "Over 2.5": price(over25),
    "Under 2.5": price(simulations - over25),
    "BTTS Yes": price(btts),
    "BTTS No": price(simulations - btts),
  };
}

/* ================================================================== */
/* Round lifecycle                                                     */
/* ================================================================== */

export type RoundStatus = "betting" | "locked" | "playing" | "settled";

export interface VirtualRound {
  id: string;
  league: string;
  fixtures: VirtualFixture[];
  status: RoundStatus;
  bettingClosesAt: string;
  commitment: RoundSeed;
  results?: VirtualResult[];
}

/**
 * The ordering here is the whole integrity story:
 *
 *   1. Generate the seed and publish its hash.
 *   2. Open betting.
 *   3. Close betting.
 *   4. ONLY THEN simulate.
 *   5. Settle, then reveal the seed.
 *
 * Simulating before betting closes — even if you do not look at the
 * result — makes the fairness proof worthless, because you could have.
 */
export class VirtualRoundManager {
  private seeds = new Map<string, string>();

  createRound(id: string, league: string, fixtures: Omit<VirtualFixture, "roundId">[], bettingSeconds = 150): VirtualRound {
    const clientSeed = createHash("sha256").update(`${id}:${Date.now()}`).digest("hex").slice(0, 16);
    const { seed, commitment } = ProvablyFairRng.commit(id, clientSeed);
    this.seeds.set(id, seed);

    return {
      id,
      league,
      fixtures: fixtures.map((f) => ({ ...f, roundId: id })),
      status: "betting",
      bettingClosesAt: new Date(Date.now() + bettingSeconds * 1000).toISOString(),
      commitment,
    };
  }

  /** Call only after betting has closed. */
  settleRound(round: VirtualRound): VirtualRound {
    if (round.status === "betting") {
      throw new Error("cannot simulate a round that is still accepting bets");
    }
    const seed = this.seeds.get(round.id);
    if (!seed) throw new Error(`no seed for round ${round.id}`);

    const results = round.fixtures.map((f, i) =>
      simulateFixture(f, seed, round.commitment.clientSeed, i)
    );

    return {
      ...round,
      status: "settled",
      results,
      commitment: { ...round.commitment, serverSeed: seed },  // revealed
    };
  }
}

/* ================================================================== */
/* Jackpots                                                            */
/* ================================================================== */

/**
 * Fixed slate of real fixtures, 1X2 only, with consolation tiers.
 * The commercial shape that works here: a small stake, a large
 * headline prize, and meaningful payouts one and two matches short —
 * most of the engagement comes from people who got 11 of 13.
 */
export interface JackpotTier {
  /** Correct picks required. */
  correct: number;
  /** Share of the pool for this tier, as a fraction. Must sum to ≤ 1. */
  poolShare: number;
}

export const DEFAULT_TIERS: JackpotTier[] = [
  { correct: 13, poolShare: 0.60 },
  { correct: 12, poolShare: 0.18 },
  { correct: 11, poolShare: 0.12 },
  { correct: 10, poolShare: 0.10 },
];

export interface JackpotEntry {
  entryId: string;
  userId: string;
  picks: ("1" | "X" | "2")[];
}

export interface JackpotSettlement {
  jackpotId: string;
  results: ("1" | "X" | "2" | "VOID")[];
  winners: { entryId: string; userId: string; correct: number; payoutKobo: number }[];
  /** Tiers with no winners. Rolls into the next jackpot. */
  rolloverKobo: number;
}

/**
 * Void fixtures — a postponed match — count as CORRECT for everyone.
 * Any other rule punishes punters for something outside their control
 * and generates more complaints than it saves money.
 */
export function settleJackpot(args: {
  jackpotId: string;
  results: ("1" | "X" | "2" | "VOID")[];
  entries: JackpotEntry[];
  prizePoolKobo: number;
  tiers?: JackpotTier[];
}): JackpotSettlement {
  const tiers = args.tiers ?? DEFAULT_TIERS;

  const scored = args.entries.map((e) => ({
    ...e,
    correct: e.picks.reduce(
      (n, pick, i) => n + (args.results[i] === "VOID" || args.results[i] === pick ? 1 : 0),
      0
    ),
  }));

  const winners: JackpotSettlement["winners"] = [];
  let rollover = 0;

  for (const tier of tiers) {
    const share = Math.round(args.prizePoolKobo * tier.poolShare);
    const inTier = scored.filter((s) => s.correct === tier.correct);

    if (!inTier.length) { rollover += share; continue; }

    // Split evenly; remainder kobo go to the first entry rather than
    // vanishing, so the ledger balances to the last unit.
    const each = Math.floor(share / inTier.length);
    const remainder = share - each * inTier.length;

    inTier.forEach((s, i) => {
      winners.push({
        entryId: s.entryId,
        userId: s.userId,
        correct: s.correct,
        payoutKobo: each + (i === 0 ? remainder : 0),
      });
    });
  }

  return { jackpotId: args.jackpotId, results: args.results, winners, rolloverKobo: rollover };
}

/* ================================================================== */

const round2 = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ */
/* Operating notes                                                     */
/* ------------------------------------------------------------------ */

export const VIRTUALS_OPERATIONS = {
  publishRtp:
    "Show the RTP percentage in the virtuals lobby and link the fairness verifier. " +
    "It costs nothing and removes the single most damaging accusation a book can face.",
  verifierEndpoint:
    "Expose GET /virtuals/rounds/:id/proof returning the server seed, client seed and " +
    "nonce. A punter should be able to recompute any settled round themselves.",
  seedRotation:
    "One server seed per round, never reused. Reusing a seed across rounds makes future " +
    "results predictable from a single revealed seed.",
  separateSettlement:
    "Virtual bets settle from the round manager, never from the sports feed pipeline. " +
    "Keeping the paths separate stops a feed outage from touching virtuals.",
  sessionLimits:
    "Virtuals run every few minutes with no natural stopping point. Enforce session " +
    "reminders and loss limits harder here than on real sport.",
  realMoneyEnabled: false,
};
