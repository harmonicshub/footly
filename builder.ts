/**
 * BET BUILDER PRICER
 * ------------------
 * Same-match legs are correlated. "Arsenal to win" and "Over 2.5 goals"
 * are not independent events, so multiplying their prices overstates
 * the true odds and hands the punter free expected value.
 *
 * The industry approach is a joint model: derive a distribution over
 * match outcomes, then evaluate every leg against that distribution
 * rather than pricing legs in isolation.
 *
 * This implementation uses a bivariate Poisson goal model, which is the
 * standard workhorse for football. It is not the most sophisticated
 * option — Dixon-Coles adjusts low-score dependence better, and copula
 * methods handle non-goal markets more honestly — but it is correct,
 * explainable, and fast enough to price a slip in under a millisecond.
 *
 * The honest caveat: markets outside goals (corners, cards, player
 * props) are priced here through separate marginal models with an
 * assumed correlation to the goal process. That assumption is the
 * weakest link. Cap builder payouts until you have enough settled
 * volume to calibrate it against reality.
 */

/* ================================================================== */
/* Types                                                               */
/* ================================================================== */

export interface BuilderLeg {
  marketKey: string;
  /** e.g. "1", "Over", "Yes", "Arsenal" */
  outcome: string;
  line?: number;
  /** The standalone price we publish for this leg. */
  standalonePrice: number;
}

export interface MatchModel {
  /** Expected goals for each side. Derived from the 1X2 + totals market. */
  lambdaHome: number;
  lambdaAway: number;
  /** Shared shock term. Captures "both teams score / neither does" games. */
  lambdaShared: number;
  /** Expected corners and cards, for the non-goal markets. */
  muCorners: number;
  muCards: number;
}

export interface BuilderQuote {
  price: number;
  /** Joint probability before margin. */
  jointProbability: number;
  /** What naive multiplication would have given. */
  naivePrice: number;
  /** How much correlation moved the price. >1 means legs reinforce. */
  correlationFactor: number;
  /** Legs that cannot coexist — the slip is impossible. */
  impossible: boolean;
  /** Legs where one guarantees another. Flag, do not price. */
  redundant: string[];
}

const MAX_GOALS = 10;
const BUILDER_MARGIN = 0.09;
const MAX_BUILDER_PRICE = 500;

/* ================================================================== */
/* Deriving the model from published prices                            */
/* ================================================================== */

/**
 * Back out expected goals from the 1X2 and Over/Under 2.5 markets.
 * We fit rather than assume: the market's own prices are the best
 * available estimate of the true distribution, and starting anywhere
 * else means the builder disagrees with the singles you publish.
 */
export function fitMatchModel(input: {
  home1x2: number; draw1x2: number; away1x2: number;
  over25: number; under25: number;
  cornersLine?: number; cornersOver?: number;
  cardsLine?: number; cardsOver?: number;
}): MatchModel {
  // Strip margin from 1X2 so the probabilities sum to 1.
  const raw = [1 / input.home1x2, 1 / input.draw1x2, 1 / input.away1x2];
  const sum = raw.reduce((a, b) => a + b, 0);
  const [pH, pD, pA] = raw.map((r) => r / sum);

  const rawOU = [1 / input.over25, 1 / input.under25];
  const ouSum = rawOU[0] + rawOU[1];
  const pOver = rawOU[0] / ouSum;

  // Grid search over (lambdaHome, lambdaAway, lambdaShared). Coarse then
  // fine — the surface is smooth, so this converges quickly and beats
  // pulling in an optimiser dependency for three parameters.
  let best = { lh: 1.4, la: 1.1, ls: 0.08, err: Infinity };

  const evaluate = (lh: number, la: number, ls: number) => {
    const d = jointGoalDistribution(lh, la, ls);
    let h = 0, dr = 0, a = 0, over = 0;
    for (let i = 0; i <= MAX_GOALS; i++) {
      for (let j = 0; j <= MAX_GOALS; j++) {
        const p = d[i][j];
        if (i > j) h += p; else if (i === j) dr += p; else a += p;
        if (i + j > 2.5) over += p;
      }
    }
    return (h - pH) ** 2 + (dr - pD) ** 2 + (a - pA) ** 2 + (over - pOver) ** 2;
  };

  for (let lh = 0.3; lh <= 3.6; lh += 0.1) {
    for (let la = 0.3; la <= 3.6; la += 0.1) {
      for (let ls = 0; ls <= 0.3; ls += 0.05) {
        const err = evaluate(lh, la, ls);
        if (err < best.err) best = { lh, la, ls, err };
      }
    }
  }
  for (let lh = best.lh - 0.1; lh <= best.lh + 0.1; lh += 0.02) {
    for (let la = best.la - 0.1; la <= best.la + 0.1; la += 0.02) {
      const err = evaluate(lh, la, best.ls);
      if (err < best.err) best = { ...best, lh, la, err };
    }
  }

  // Corners and cards from their own markets where available; sensible
  // league defaults otherwise, scaled by total expected goals since
  // open games produce more of both.
  const totalGoals = best.lh + best.la + 2 * best.ls;
  const muCorners = input.cornersLine && input.cornersOver
    ? solvePoissonMean(input.cornersLine, 1 / input.cornersOver)
    : 9.2 + (totalGoals - 2.6) * 0.6;
  const muCards = input.cardsLine && input.cardsOver
    ? solvePoissonMean(input.cardsLine, 1 / input.cardsOver)
    : 4.1;

  return {
    lambdaHome: best.lh, lambdaAway: best.la, lambdaShared: best.ls,
    muCorners: Math.max(4, muCorners), muCards: Math.max(1.5, muCards),
  };
}

/* ================================================================== */
/* Distributions                                                       */
/* ================================================================== */

const factorial = (() => {
  const cache = [1];
  return (n: number) => {
    for (let i = cache.length; i <= n; i++) cache[i] = cache[i - 1] * i;
    return cache[n];
  };
})();

const poisson = (k: number, lambda: number) =>
  (Math.exp(-lambda) * lambda ** k) / factorial(k);

/**
 * Bivariate Poisson. X = A + C, Y = B + C where C is the shared shock.
 * The shared term is what makes "both teams to score" correlate with
 * "over 2.5" more strongly than independent Poisson would predict.
 */
export function jointGoalDistribution(lh: number, la: number, ls: number): number[][] {
  const grid: number[][] = Array.from({ length: MAX_GOALS + 1 }, () =>
    new Array(MAX_GOALS + 1).fill(0)
  );

  for (let i = 0; i <= MAX_GOALS; i++) {
    for (let j = 0; j <= MAX_GOALS; j++) {
      let p = 0;
      const kMax = Math.min(i, j);
      for (let k = 0; k <= kMax; k++) {
        p += poisson(i - k, lh) * poisson(j - k, la) * poisson(k, ls);
      }
      grid[i][j] = p;
    }
  }
  return grid;
}

/** Inverts P(X > line) to find the Poisson mean. Used for corners/cards. */
function solvePoissonMean(line: number, pOver: number): number {
  let lo = 0.5, hi = 25;
  for (let iter = 0; iter < 40; iter++) {
    const mid = (lo + hi) / 2;
    let cum = 0;
    for (let k = 0; k <= Math.floor(line); k++) cum += poisson(k, mid);
    if (1 - cum < pOver) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ================================================================== */
/* Leg evaluation                                                      */
/* ================================================================== */

/**
 * Does this leg win, given a specific scoreline? Returns null for legs
 * the goal model cannot resolve (corners, cards, player props), which
 * are handled by the marginal path below.
 */
function legWinsOnScore(leg: BuilderLeg, home: number, away: number): boolean | null {
  const total = home + away;
  const o = leg.outcome;
  const line = leg.line ?? 2.5;

  switch (leg.marketKey) {
    case "1x2":
      return o === "1" ? home > away : o === "X" ? home === away : away > home;
    case "dc":
      return o === "1X" ? home >= away : o === "12" ? home !== away : away >= home;
    case "dnb":
      if (home === away) return null;   // stake refunded; treat separately
      return o === "1" ? home > away : away > home;
    case "ou_goals":
      return o.startsWith("Over") ? total > line : total < line;
    case "btts":
      return o === "Yes" ? home > 0 && away > 0 : home === 0 || away === 0;
    case "correct_score": {
      const [h, a] = o.split("-").map(Number);
      return home === h && away === a;
    }
    case "exact_goals":
      return total === Number(o);
    case "goal_range": {
      const [lo, hi] = o.split("-").map(Number);
      return o.endsWith("+") ? total >= Number(o) : total >= lo && total <= hi;
    }
    case "odd_even_goals":
      return o === "Odd" ? total % 2 === 1 : total % 2 === 0;
    case "clean_sheet":
      return o.startsWith("Home") ? away === 0 : home === 0;
    case "win_to_nil":
      return o === "Home" ? home > away && away === 0 : away > home && home === 0;
    case "winning_margin": {
      const diff = Math.abs(home - away);
      if (o === "Draw") return home === away;
      const by = Number(o.replace(/\D/g, ""));
      const homeWin = home > away;
      const wantsHome = o.toLowerCase().includes("home");
      if (o.includes("+")) return homeWin === wantsHome && diff >= by;
      return homeWin === wantsHome && diff === by;
    }
    case "team_ou":
      return o.includes("Home")
        ? (o.includes("over") ? home > line : home < line)
        : (o.includes("over") ? away > line : away < line);
    case "ah": {
      const adj = o.includes("Home") ? home + line : away + line;
      const other = o.includes("Home") ? away : home;
      return adj > other;
    }
    case "multigoal": {
      const [lo, hi] = o.split("-").map(Number);
      return total >= lo && total <= hi;
    }
    default:
      return null;
  }
}

/* ================================================================== */
/* Pricing                                                             */
/* ================================================================== */

/**
 * Prices a same-match slip by integrating over the joint scoreline
 * distribution. Legs the goal model cannot express are folded in as
 * marginals with a dampened correlation adjustment — honest about
 * being an approximation rather than pretending to independence.
 */
export function priceBuilder(legs: BuilderLeg[], model: MatchModel): BuilderQuote {
  const naivePrice = legs.reduce((a, l) => a * l.standalonePrice, 1);

  const redundant = findRedundant(legs);
  const grid = jointGoalDistribution(model.lambdaHome, model.lambdaAway, model.lambdaShared);

  const goalLegs = legs.filter((l) => legWinsOnScore(l, 1, 0) !== null);
  const otherLegs = legs.filter((l) => legWinsOnScore(l, 1, 0) === null);

  /* --- exact joint probability over the goal legs --- */
  let jointGoalProb = 0;
  let gridMass = 0;

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = grid[h][a];
      gridMass += p;
      if (goalLegs.every((l) => legWinsOnScore(l, h, a) === true)) jointGoalProb += p;
    }
  }
  // Renormalise: the grid truncates at 10 goals a side.
  jointGoalProb = gridMass > 0 ? jointGoalProb / gridMass : 0;

  if (jointGoalProb <= 0 && goalLegs.length) {
    return {
      price: 0, jointProbability: 0, naivePrice,
      correlationFactor: 0, impossible: true, redundant,
    };
  }

  /**
   * Non-goal legs. Their marginal probability comes from the price we
   * already publish, with a correlation nudge toward the goal outcome:
   * high-scoring games produce more corners, and one-sided games fewer
   * cards. The dampening factor keeps the adjustment modest — being
   * roughly right beats being confidently wrong.
   */
  let otherProb = 1;
  const expectedTotal = model.lambdaHome + model.lambdaAway + 2 * model.lambdaShared;

  for (const l of otherLegs) {
    const marginal = stripMargin(l.standalonePrice);
    const adj = correlationNudge(l, goalLegs, expectedTotal);
    otherProb *= clamp(marginal * adj, 0.001, 0.999);
  }

  const joint = (goalLegs.length ? jointGoalProb : 1) * otherProb;
  const fair = 1 / joint;
  const priced = fair / (1 + BUILDER_MARGIN);
  const price = Math.min(MAX_BUILDER_PRICE, Math.max(1.01, round2(priced)));

  return {
    price,
    jointProbability: joint,
    naivePrice: round2(naivePrice),
    correlationFactor: round2(price / naivePrice),
    impossible: false,
    redundant,
  };
}

/**
 * Legs where one outcome guarantees another. "Arsenal to win" plus
 * "Arsenal double chance 1X" is not a two-leg bet — it is a one-leg bet
 * the punter is being charged twice for. Block it rather than price it.
 */
function findRedundant(legs: BuilderLeg[]): string[] {
  const out: string[] = [];
  const has = (key: string, outcome?: string) =>
    legs.find((l) => l.marketKey === key && (!outcome || l.outcome === outcome));

  const home = has("1x2", "1"), away = has("1x2", "2"), draw = has("1x2", "X");

  if (home && has("dc", "1X")) out.push("1x2:1 makes dc:1X certain");
  if (away && has("dc", "X2")) out.push("1x2:2 makes dc:X2 certain");
  if (home && has("dnb", "1")) out.push("1x2:1 makes dnb:1 certain");
  if (draw && has("btts")) out.push("draw plus BTTS heavily overlaps — price as correct score");

  const cs = has("correct_score");
  if (cs && legs.length > 1) out.push("correct score already fixes every goal market");

  return out;
}

/**
 * Nudges a non-goal marginal based on what the goal legs imply. Small
 * multipliers by design — these are the numbers to calibrate first once
 * you have settled volume.
 */
function correlationNudge(leg: BuilderLeg, goalLegs: BuilderLeg[], expectedTotal: number): number {
  const wantsOver = goalLegs.some(
    (g) => g.marketKey === "ou_goals" && g.outcome.startsWith("Over")
  );
  const wantsUnder = goalLegs.some(
    (g) => g.marketKey === "ou_goals" && g.outcome.startsWith("Under")
  );
  const wantsBtts = goalLegs.some((g) => g.marketKey === "btts" && g.outcome === "Yes");

  const isOver = leg.outcome.startsWith("Over");

  if (leg.marketKey.startsWith("corners")) {
    // Open, high-scoring games generate more corners.
    if ((wantsOver || wantsBtts) && isOver) return 1.08;
    if (wantsUnder && isOver) return 0.93;
    if (wantsUnder && !isOver) return 1.06;
    return 1;
  }

  if (leg.marketKey.startsWith("cards") || leg.marketKey === "red_card") {
    // Tight, low-scoring games are the physical ones.
    if (wantsUnder && isOver) return 1.07;
    if (wantsOver && isOver) return 0.95;
    return 1;
  }

  if (leg.marketKey.includes("scorer")) {
    // A scorer leg and an over leg reinforce each other strongly.
    if (wantsOver) return 1.12;
    if (wantsUnder) return 0.82;
    if (expectedTotal > 3) return 1.05;
    return 1;
  }

  return 1;
}

/* ================================================================== */
/* Guards                                                              */
/* ================================================================== */

export const BUILDER_LIMITS = {
  minLegs: 2,
  maxLegs: 8,
  /** Until the model is calibrated, cap what a builder can return. */
  maxPayoutKobo: 2_000_000_00,
  maxStakeKobo: 50_000_00,
  /**
   * Real-money mode stays off until licensing is in place. Flip this
   * in config, not in code.
   */
  realMoneyEnabled: false,
};

export function validateBuilder(legs: BuilderLeg[], quote: BuilderQuote): string[] {
  const errors: string[] = [];
  if (legs.length < BUILDER_LIMITS.minLegs) errors.push("A builder needs at least two selections.");
  if (legs.length > BUILDER_LIMITS.maxLegs) errors.push(`Maximum ${BUILDER_LIMITS.maxLegs} selections on a builder.`);
  if (quote.impossible) errors.push("Those selections cannot all happen in one match.");
  if (quote.redundant.length) errors.push("One of your selections is already covered by another.");
  if (quote.correlationFactor > 1.6) {
    // Our price is far above naive multiplication — usually a model
    // artefact rather than genuine value. Review before publishing.
    errors.push("Price needs manual review.");
  }
  return errors;
}

/* ================================================================== */

const stripMargin = (price: number) => (1 / price) / (1 + BUILDER_MARGIN / 2);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ */
/* Worked example                                                      */
/* ------------------------------------------------------------------ */

/**
 * Arsenal 1.42 / draw 4.80 / Chelsea 6.20, over 2.5 at 1.80.
 *
 *   Legs: Arsenal to win (1.42) + Over 2.5 (1.80)
 *   Naive:        1.42 × 1.80 = 2.56
 *   Correlated:   ~2.24
 *
 * The correlated price is lower because a strong favourite winning and
 * a high-scoring game reinforce each other — the favourite scores the
 * goals. Publishing 2.56 hands away roughly 13% edge on every such slip.
 */
export function example() {
  const model = fitMatchModel({
    home1x2: 1.42, draw1x2: 4.80, away1x2: 6.20,
    over25: 1.80, under25: 2.00,
  });
  return priceBuilder(
    [
      { marketKey: "1x2", outcome: "1", standalonePrice: 1.42 },
      { marketKey: "ou_goals", outcome: "Over 2.5", line: 2.5, standalonePrice: 1.80 },
    ],
    model
  );
}
