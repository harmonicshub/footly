import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  Search, Bell, User, Plus, X, Trash2, Ticket, ChevronDown, ChevronLeft,
  Home, Trophy, Clock, Wallet, Copy, Check, Zap, Layers, ChevronRight,
  Minus, ArrowUpRight, ArrowDownLeft, Receipt, Shield, Flame, Settings,
  LifeBuoy, FileText, LogOut, Building2, SlidersHorizontal, Gift, Dice5,
  Banknote, BadgeCheck, AlertTriangle, Share2, Smartphone
} from "lucide-react";

/* ==================================================================
   FOOTLY — deep orange on light
   ------------------------------------------------------------------
   Two colour-system decisions that fall out of choosing orange:

   1. LIVE is no longer amber. Amber and deep orange are neighbours,
      so a live flag in amber competes with every selected odds button
      on screen. Live is now a dark neutral pill with a pulsing red
      dot — it stays legible without fighting the brand.

   2. MONEY IS GREEN, not orange. Winnings, credits and won legs use a
      dedicated green. If the brand colour also means "you won", every
      selected button starts reading as a payout. Separating them means
      a punter can scan a settled slip and know instantly what paid.

   Neutrals are warm rather than cool — cool greys under an orange
   accent read muddy.
   ================================================================== */

const BRAND = { first: "Foot", second: "ly" };

const C = {
  bg: "#F8F7F5", surface: "#FFFFFF", raised: "#F1F0ED", hover: "#E7E5E1",
  line: "#E4E2DE", lineSoft: "#EFEEEB",

  accent: "#D9480F",        // deep orange — brand, selected, primary
  accentInk: "#9C340B",     // orange text on light backgrounds
  accentWash: "#FDF0E9",

  live: "#1F2A37",          // neutral pill so it never competes
  liveDot: "#F04438",

  money: "#067647",         // winnings, credits, won legs
  moneyWash: "#E7F5EE",

  danger: "#B42318", dangerWash: "#FEF3F2",
  warn: "#B54708", warnWash: "#FEF6EE",

  text: "#1A1614", dim: "#5A524E", muted: "#8A827D",
};

const DISPLAY = "'Plus Jakarta Sans', system-ui, sans-serif";
const BODY = "'Inter', system-ui, -apple-system, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";

/* ================================================================== */
/* Data                                                                */
/* ================================================================== */

const FIXTURES = [
  {
    league: "England · Premier League", id: "epl",
    games: [
      { id: "e1", home: "Arsenal", away: "Chelsea", live: true, minute: 67, hs: 2, as: 1, odds: { "1": 1.42, X: 4.80, "2": 6.20 }, featured: true },
      { id: "e2", home: "Man United", away: "Liverpool", time: "18:30", odds: { "1": 3.10, X: 3.45, "2": 2.25 }, featured: true },
      { id: "e3", home: "Tottenham", away: "Newcastle", time: "21:00", odds: { "1": 2.05, X: 3.60, "2": 3.40 } },
    ],
  },
  {
    league: "Nigeria · NPFL", id: "npfl",
    games: [
      { id: "n1", home: "Enyimba", away: "Rivers United", live: true, minute: 34, hs: 1, as: 0, odds: { "1": 1.85, X: 3.20, "2": 4.10 }, featured: true },
      { id: "n2", home: "Rangers Intl", away: "Remo Stars", time: "16:00", odds: { "1": 2.40, X: 2.95, "2": 3.05 } },
      { id: "n3", home: "Kano Pillars", away: "Plateau United", time: "16:00", odds: { "1": 1.95, X: 3.10, "2": 3.90 } },
    ],
  },
  {
    league: "Spain · La Liga", id: "laliga",
    games: [
      { id: "s1", home: "Real Madrid", away: "Sevilla", time: "20:00", odds: { "1": 1.36, X: 5.10, "2": 7.80 }, featured: true },
      { id: "s2", home: "Barcelona", away: "Real Betis", time: "22:15", odds: { "1": 1.28, X: 6.00, "2": 9.50 } },
    ],
  },
];

const BASKETBALL = [{
  league: "USA · NBA", id: "nba",
  games: [
    { id: "b1", home: "Lakers", away: "Celtics", time: "02:30", odds: { "1": 1.90, X: 15.0, "2": 1.95 } },
    { id: "b2", home: "Warriors", away: "Nuggets", time: "04:00", odds: { "1": 2.20, X: 17.0, "2": 1.72 } },
  ],
}];

const TENNIS = [{
  league: "ATP · Cincinnati", id: "atp",
  games: [
    { id: "t1", home: "Alcaraz", away: "Zverev", time: "17:00", odds: { "1": 1.44, X: 26.0, "2": 2.75 } },
    { id: "t2", home: "Sinner", away: "Rune", live: true, minute: 42, hs: 1, as: 0, odds: { "1": 1.28, X: 30.0, "2": 3.60 } },
  ],
}];

const SPORTS = [
  { key: "Football", data: FIXTURES },
  { key: "Basketball", data: BASKETBALL },
  { key: "Tennis", data: TENNIS },
  { key: "Virtuals", data: null },
  { key: "Jackpot", data: null },
];

const FILTERS = ["Live", "Today", "Tomorrow", "Boosted"];

const GROUPS = [
  { key: "main", label: "Main" }, { key: "goals", label: "Goals" },
  { key: "handicap", label: "Handicap" }, { key: "halves", label: "Halves" },
  { key: "combos", label: "Combos" }, { key: "score", label: "Correct score" },
  { key: "scorers", label: "Goalscorers" }, { key: "team", label: "Team totals" },
  { key: "corners", label: "Corners" }, { key: "cards", label: "Cards" },
  { key: "timing", label: "Timing" }, { key: "specials", label: "Specials" },
];

const INITIAL_OPEN_BETS = [
  { id: "b1", legs: 5, stake: 1000, odds: 24.6, label: "Weekend acca", status: "3 of 5 landed", code: "K7M2QX",
    picks: [
      { pick: "Arsenal", market: "1X2", match: "Arsenal v Chelsea", odd: 1.42, state: "won" },
      { pick: "Over 2.5", market: "Total goals", match: "Man Utd v Liverpool", odd: 1.86, state: "won" },
      { pick: "Both teams to score — Yes", market: "BTTS", match: "Real Madrid v Sevilla", odd: 1.72, state: "won" },
      { pick: "Enyimba", market: "Draw no bet", match: "Enyimba v Rivers Utd", odd: 1.55, state: "open" },
      { pick: "Over 9.5 corners", market: "Corners", match: "Spurs v Newcastle", odd: 1.91, state: "open" },
    ] },
  { id: "b2", legs: 1, stake: 500, odds: 1.85, label: "Enyimba DNB", status: "In play · 34'", code: "H4RM0N",
    picks: [{ pick: "Enyimba", market: "Draw no bet", match: "Enyimba v Rivers Utd", odd: 1.85, state: "open" }] },
];

const SETTLED_BETS = [
  { id: "b3", legs: 3, stake: 2000, odds: 6.4, result: "won", payout: 12800, label: "NPFL treble", code: "PL9DK2",
    picks: [
      { pick: "Rangers Intl", market: "1X2", match: "Rangers v Remo", odd: 2.40, state: "won" },
      { pick: "Under 3.5", market: "Total goals", match: "Kano v Plateau", odd: 1.34, state: "won" },
      { pick: "1X", market: "Double chance", match: "Enyimba v Rivers", odd: 1.99, state: "won" },
    ] },
  { id: "b4", legs: 8, stake: 500, odds: 112.0, result: "lost", payout: 0, label: "Saturday long shot", code: "TT4RB8",
    picks: [{ pick: "Chelsea", market: "1X2", match: "Arsenal v Chelsea", odd: 6.20, state: "lost" }] },
];

const TRANSACTIONS = [
  { id: 1, kind: "win", label: "Bet won · 5 legs", amount: 18400, at: "Today, 16:42" },
  { id: 2, kind: "stake", label: "Bet placed · Arsenal v Chelsea", amount: -1000, at: "Today, 15:58" },
  { id: 3, kind: "deposit", label: "Deposit · OPay", amount: 10000, at: "Today, 12:04" },
  { id: 4, kind: "withdrawal", label: "Withdrawal · Kuda", amount: -25000, at: "Yesterday, 21:17" },
  { id: 5, kind: "deposit", label: "Deposit · Bank transfer", amount: 20000, at: "9 Aug, 09:22" },
  { id: 6, kind: "stake", label: "Bet placed · NPFL treble", amount: -2000, at: "8 Aug, 14:11" },
];

const NOTIFICATIONS = [
  { id: 1, kind: "win", title: "Your bet won", body: "NPFL treble returned ₦12,800.", at: "16:42", unread: true },
  { id: 2, kind: "promo", title: "Acca bonus raised", body: "10-leg accumulators now pay 30% extra on winnings.", at: "12:10", unread: true },
  { id: 3, kind: "wallet", title: "Withdrawal paid", body: "₦25,000 sent to Kuda •••4471.", at: "Yesterday", unread: false },
  { id: 4, kind: "match", title: "Kick-off in 15 minutes", body: "Man United v Liverpool starts at 18:30.", at: "Yesterday", unread: false },
];

const BANKS = [
  { id: "bk1", name: "Kuda Bank", acct: "•••• 4471", holder: "Bassey H. U.", primary: true, verified: true },
  { id: "bk2", name: "OPay", acct: "•••• 2210", holder: "Bassey H. U.", primary: false, verified: true },
];

const PROMOS = [
  { id: "p1", kind: "Welcome", title: "100% first deposit bonus", body: "Up to ₦50,000. Stake it five times on accumulators of three or more legs within seven days.", cta: "Claim" },
  { id: "p2", kind: "Insurance", title: "One cut, we refund", body: "Five legs or more and exactly one loses — we return your stake as a free bet up to ₦10,000.", cta: "How it works" },
  { id: "p3", kind: "Boost", title: "Accumulator bonus to 170%", body: "Winnings boosted by leg count. Legs under 1.20 do not count toward the total.", cta: "See the ladder" },
];

const JACKPOT_FIXTURES = [
  { id: "j1", home: "Arsenal", away: "Chelsea" },
  { id: "j2", home: "Man United", away: "Liverpool" },
  { id: "j3", home: "Real Madrid", away: "Sevilla" },
  { id: "j4", home: "Barcelona", away: "Real Betis" },
  { id: "j5", home: "Enyimba", away: "Rivers United" },
  { id: "j6", home: "Rangers Intl", away: "Remo Stars" },
  { id: "j7", home: "Kano Pillars", away: "Plateau United" },
];

const VIRTUAL_ROUND = [
  { id: "v1", home: "Lagos City", away: "Kano Stars", odds: { "1": 2.10, X: 3.20, "2": 3.05 } },
  { id: "v2", home: "Abuja Rangers", away: "Port United", odds: { "1": 1.72, X: 3.50, "2": 4.20 } },
  { id: "v3", home: "Delta FC", away: "Jos Rovers", odds: { "1": 2.45, X: 3.10, "2": 2.70 } },
];

/* ---- deterministic demo pricing ---- */
const seed = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
};
const px = (base, key, spread = 0.22) =>
  Math.max(1.02, +(base * (1 - spread / 2 + seed(key) * spread)).toFixed(2));

function buildBoard(g) {
  const k = (s) => g.id + s;
  const o = g.odds;
  const fav = o["1"] < o["2"];
  const M = [];
  const add = (group, name, outcomes, note) =>
    M.push({ id: `${g.id}:${group}:${name}`, group, name, note, outcomes });

  add("main", "1X2", [{ label: "1", odd: o["1"] }, { label: "X", odd: o.X }, { label: "2", odd: o["2"] }]);
  add("main", "Double chance", [
    { label: "1X", odd: +(1 / (1 / o["1"] + 1 / o.X) * 1.06).toFixed(2) },
    { label: "12", odd: +(1 / (1 / o["1"] + 1 / o["2"]) * 1.06).toFixed(2) },
    { label: "X2", odd: +(1 / (1 / o.X + 1 / o["2"]) * 1.06).toFixed(2) }]);
  add("main", "Draw no bet", [
    { label: "1", odd: px(o["1"] * 0.78, k("dnb1")) }, { label: "2", odd: px(o["2"] * 0.78, k("dnb2")) }]);

  [0.5, 1.5, 2.5, 3.5, 4.5, 5.5].forEach((l) =>
    add("goals", `Total goals over/under ${l}`, [
      { label: `Over ${l}`, odd: px(1.15 + l * 0.55, k("ovr" + l)) },
      { label: `Under ${l}`, odd: px(6.2 - l * 0.95, k("und" + l)) }]));
  add("goals", "Both teams to score", [
    { label: "Yes", odd: px(1.72, k("bttsy")) }, { label: "No", odd: px(2.05, k("bttsn")) }]);
  add("goals", "Total goals range", [
    { label: "0-1", odd: px(3.4, k("r01")) }, { label: "2-3", odd: px(2.0, k("r23")) },
    { label: "4-6", odd: px(3.9, k("r46")) }, { label: "7+", odd: px(26, k("r7")) }]);
  add("goals", "Odd/even goals", [
    { label: "Odd", odd: px(1.94, k("odd")) }, { label: "Even", odd: px(1.92, k("even")) }]);
  add("goals", "Winning margin", [
    { label: "1 goal", odd: px(2.6, k("m1")) }, { label: "2 goals", odd: px(4.1, k("m2")) },
    { label: "3+ goals", odd: px(5.2, k("m3")) }, { label: "Draw", odd: o.X }]);
  add("goals", "Highest scoring half", [
    { label: "1st", odd: px(2.9, k("h1")) }, { label: "2nd", odd: px(2.05, k("h2")) },
    { label: "Equal", odd: px(3.5, k("heq")) }]);
  add("goals", "Win to nil", [
    { label: g.home, odd: px(o["1"] * 1.85, k("wtn1")) }, { label: g.away, odd: px(o["2"] * 1.85, k("wtn2")) }]);

  [-2, -1.5, -1, -0.5, 0.5, 1, 1.5, 2].forEach((l) =>
    add("handicap", `Asian handicap ${l > 0 ? "+" + l : l}`, [
      { label: `${g.home} ${l > 0 ? "+" + l : l}`, odd: px(1.9 + l * (fav ? 0.55 : -0.55), k("ah1" + l)) },
      { label: `${g.away} ${-l > 0 ? "+" + -l : -l}`, odd: px(1.9 - l * (fav ? 0.55 : -0.55), k("ah2" + l)) }]));
  [-2, -1, 1, 2].forEach((l) =>
    add("handicap", `European handicap ${l > 0 ? "+" + l : l}`, [
      { label: "1", odd: px(o["1"] * (1 + l * 0.45), k("eh1" + l)) },
      { label: "X", odd: px(o.X * 1.5, k("ehx" + l)) },
      { label: "2", odd: px(o["2"] * (1 - l * 0.45), k("eh2" + l)) }]));

  add("halves", "1X2 — 1st half", [
    { label: "1", odd: px(o["1"] * 1.5, k("f1")) }, { label: "X", odd: px(2.15, k("fx")) },
    { label: "2", odd: px(o["2"] * 1.5, k("f2")) }]);
  add("halves", "1X2 — 2nd half", [
    { label: "1", odd: px(o["1"] * 1.35, k("s1")) }, { label: "X", odd: px(2.6, k("sx")) },
    { label: "2", odd: px(o["2"] * 1.35, k("s2")) }]);
  add("halves", "Half time / full time", [
    { label: "1/1", odd: px(o["1"] * 1.7, k("hf11")) }, { label: "X/1", odd: px(5.4, k("hfx1")) },
    { label: "2/1", odd: px(24, k("hf21")) }, { label: "1/X", odd: px(15, k("hf1x")) },
    { label: "X/X", odd: px(5.1, k("hfxx")) }, { label: "2/X", odd: px(16, k("hf2x")) },
    { label: "1/2", odd: px(38, k("hf12")) }, { label: "X/2", odd: px(7.2, k("hfx2")) },
    { label: "2/2", odd: px(o["2"] * 1.7, k("hf22")) }]);
  [0.5, 1.5, 2.5].forEach((l) =>
    add("halves", `1st half goals over/under ${l}`, [
      { label: `Over ${l}`, odd: px(1.35 + l * 0.9, k("fovr" + l)) },
      { label: `Under ${l}`, odd: px(4.0 - l * 0.85, k("fund" + l)) }]));
  add("halves", "Both teams to score — 1st half", [
    { label: "Yes", odd: px(4.1, k("fbtty")) }, { label: "No", odd: px(1.21, k("fbttn")) }]);

  add("combos", "Result and both teams to score", [
    { label: "1 & Yes", odd: px(o["1"] * 2.3, k("c1y")) }, { label: "1 & No", odd: px(o["1"] * 1.9, k("c1n")) },
    { label: "X & Yes", odd: px(5.6, k("cxy")) }, { label: "X & No", odd: px(11, k("cxn")) },
    { label: "2 & Yes", odd: px(o["2"] * 2.3, k("c2y")) }, { label: "2 & No", odd: px(o["2"] * 1.9, k("c2n")) }]);
  add("combos", "Result and over/under 2.5", [
    { label: "1 & Over", odd: px(o["1"] * 2.0, k("ro1o")) }, { label: "1 & Under", odd: px(o["1"] * 2.2, k("ro1u")) },
    { label: "X & Over", odd: px(9.5, k("roxo")) }, { label: "X & Under", odd: px(5.0, k("roxu")) },
    { label: "2 & Over", odd: px(o["2"] * 2.0, k("ro2o")) }, { label: "2 & Under", odd: px(o["2"] * 2.2, k("ro2u")) }]);
  add("combos", "Double chance and BTTS", [
    { label: "1X & Yes", odd: px(2.3, k("dcy1")) }, { label: "1X & No", odd: px(2.6, k("dcn1")) },
    { label: "12 & Yes", odd: px(2.0, k("dcy2")) }, { label: "12 & No", odd: px(2.4, k("dcn2")) },
    { label: "X2 & Yes", odd: px(2.9, k("dcy3")) }, { label: "X2 & No", odd: px(3.3, k("dcn3")) }]);
  add("combos", "Multigoal", [
    { label: "1-2", odd: px(2.4, k("mg12")) }, { label: "1-3", odd: px(1.6, k("mg13")) },
    { label: "2-3", odd: px(2.2, k("mg23")) }, { label: "2-4", odd: px(1.7, k("mg24")) },
    { label: "3-5", odd: px(2.6, k("mg35")) }, { label: "4-6", odd: px(5.4, k("mg46")) }]);

  const scores = ["1-0", "2-0", "2-1", "3-0", "3-1", "3-2", "0-0", "1-1", "2-2", "3-3", "0-1", "0-2", "1-2", "0-3", "1-3", "2-3"];
  add("score", "Correct score", scores.map((s) => ({ label: s, odd: px(9, k("cs" + s), 1.7) })), "Any other score settles separately");
  add("score", "Correct score — 1st half", ["1-0", "0-0", "0-1", "1-1", "2-0", "0-2"].map((s) => ({ label: s, odd: px(6, k("cs1h" + s), 1.4) })));
  add("score", "Bore draw (0-0)", [
    { label: "Yes", odd: px(11, k("bore")) }, { label: "No", odd: px(1.08, k("borem")) }]);

  const squad = [`${g.home} striker`, `${g.home} winger`, `${g.home} midfielder`, `${g.away} striker`, `${g.away} winger`, `${g.away} midfielder`];
  add("scorers", "Anytime goalscorer", squad.map((p) => ({ label: p, odd: px(3.2, k("any" + p), 1.2) })));
  add("scorers", "First goalscorer", squad.map((p) => ({ label: p, odd: px(8.0, k("fgs" + p), 1.2) })));
  add("scorers", "To score 2 or more", squad.map((p) => ({ label: p, odd: px(11, k("2p" + p), 1.2) })));
  add("scorers", "First team to score", [
    { label: g.home, odd: px(o["1"] * 1.25, k("fts1")) }, { label: g.away, odd: px(o["2"] * 1.25, k("fts2")) },
    { label: "No goal", odd: px(13, k("ftsn")) }]);

  [g.home, g.away].forEach((t, i) =>
    [0.5, 1.5, 2.5].forEach((l) =>
      add("team", `${t} total goals ${l}`, [
        { label: `Over ${l}`, odd: px(1.3 + l * 0.85 + (i ? 0.3 : 0), k("tt" + t + l + "o")) },
        { label: `Under ${l}`, odd: px(3.6 - l * 0.6 - (i ? 0.2 : 0), k("tt" + t + l + "u")) }])));
  add("team", "Team to score in both halves", [
    { label: g.home, odd: px(3.4, k("sbh1")) }, { label: g.away, odd: px(4.6, k("sbh2")) }]);
  add("team", "Team to win both halves", [
    { label: g.home, odd: px(4.2, k("wbh1")) }, { label: g.away, odd: px(7.5, k("wbh2")) }]);
  add("team", "Come from behind to win", [
    { label: g.home, odd: px(9.5, k("cfb1")) }, { label: g.away, odd: px(13, k("cfb2")) }]);

  [8.5, 9.5, 10.5, 11.5, 12.5].forEach((l) =>
    add("corners", `Total corners over/under ${l}`, [
      { label: `Over ${l}`, odd: px(1.55 + (l - 8.5) * 0.28, k("co" + l)) },
      { label: `Under ${l}`, odd: px(2.35 - (l - 8.5) * 0.22, k("cu" + l)) }]));
  add("corners", "Corners 3-way", [
    { label: g.home, odd: px(1.75, k("c3h")) }, { label: "Tie", odd: px(7.5, k("c3t")) },
    { label: g.away, odd: px(3.1, k("c3a")) }]);
  add("corners", "First corner", [
    { label: g.home, odd: px(1.72, k("fc1")) }, { label: g.away, odd: px(2.05, k("fc2")) }]);
  add("corners", "Corner race to 5", [
    { label: g.home, odd: px(1.68, k("cr1")) }, { label: g.away, odd: px(2.55, k("cr2")) },
    { label: "Neither", odd: px(9.0, k("crn")) }]);
  add("corners", "Corners odd/even", [
    { label: "Odd", odd: px(1.92, k("cod")) }, { label: "Even", odd: px(1.9, k("cev")) }]);

  [2.5, 3.5, 4.5, 5.5].forEach((l) =>
    add("cards", `Total cards over/under ${l}`, [
      { label: `Over ${l}`, odd: px(1.45 + (l - 2.5) * 0.42, k("kd" + l)) },
      { label: `Under ${l}`, odd: px(2.5 - (l - 2.5) * 0.3, k("ku" + l)) }]));
  [25.5, 35.5, 45.5].forEach((l) =>
    add("cards", `Booking points over/under ${l}`, [
      { label: `Over ${l}`, odd: px(1.6 + (l - 25.5) * 0.02, k("bp" + l)) },
      { label: `Under ${l}`, odd: px(2.2 - (l - 25.5) * 0.015, k("bpu" + l)) }], "Yellow 10 · Red 25"));
  add("cards", "Red card in match", [
    { label: "Yes", odd: px(5.8, k("rcy")) }, { label: "No", odd: px(1.13, k("rcn")) }]);
  add("cards", "Cards 3-way", [
    { label: g.home, odd: px(2.4, k("k3h")) }, { label: "Tie", odd: px(4.2, k("k3t")) },
    { label: g.away, odd: px(2.2, k("k3a")) }]);

  add("timing", "Time of first goal", [
    { label: "1-15", odd: px(3.5, k("t1")) }, { label: "16-30", odd: px(4.1, k("t2")) },
    { label: "31-45", odd: px(4.6, k("t3")) }, { label: "46-60", odd: px(5.4, k("t4")) },
    { label: "61-75", odd: px(7.0, k("t5")) }, { label: "76-90", odd: px(8.5, k("t6")) },
    { label: "No goal", odd: px(13, k("t7")) }]);
  [10, 20, 30, 45].forEach((m) =>
    add("timing", `Goal before minute ${m}`, [
      { label: "Yes", odd: px(3.6 - m * 0.05, k("gb" + m)) },
      { label: "No", odd: px(1.25 + m * 0.02, k("gbn" + m)) }]));
  add("timing", "Race to 2 goals", [
    { label: g.home, odd: px(o["1"] * 1.4, k("r2h")) }, { label: g.away, odd: px(o["2"] * 1.4, k("r2a")) },
    { label: "Neither", odd: px(3.9, k("r2n")) }]);

  add("specials", "Penalty awarded", [
    { label: "Yes", odd: px(3.9, k("peny")) }, { label: "No", odd: px(1.24, k("penn")) }]);
  add("specials", "Own goal", [
    { label: "Yes", odd: px(14, k("ogy")) }, { label: "No", odd: px(1.03, k("ogn")) }]);
  add("specials", "VAR review", [
    { label: "Yes", odd: px(2.6, k("vary")) }, { label: "No", odd: px(1.45, k("varn")) }]);
  [21.5, 24.5, 27.5].forEach((l) =>
    add("specials", `Total fouls over/under ${l}`, [
      { label: `Over ${l}`, odd: px(1.85, k("fo" + l)) }, { label: `Under ${l}`, odd: px(1.88, k("fu" + l)) }]));
  add("specials", "Total offsides over/under 3.5", [
    { label: "Over 3.5", odd: px(1.9, k("offo")) }, { label: "Under 3.5", odd: px(1.85, k("offu")) }]);

  return M;
}

const naira = (n) => "₦" + n.toLocaleString("en-NG", { maximumFractionDigits: 2 });
const makeCode = () => {
  const ch = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => ch[Math.floor(Math.random() * ch.length)]).join("");
};
const ALL_GAMES = [...FIXTURES, ...BASKETBALL, ...TENNIS].flatMap((l) =>
  l.games.map((g) => ({ ...g, league: l.league, leagueId: l.id })));
const FEATURED = ALL_GAMES.filter((g) => g.featured);

/* ================================================================== */

export default function Footly() {
  const [stack, setStack] = useState([{ name: "home" }]);
  const top = stack[stack.length - 1];
  const go = useCallback((name, params = {}) => setStack((s) => [...s, { name, ...params }]), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const reset = useCallback((name = "home", params = {}) => setStack([{ name, ...params }]), []);

  const [sport, setSport] = useState("Football");
  const [filter, setFilter] = useState("Today");

  const [slip, setSlip] = useState([]);
  const [slipState, setSlipState] = useState("bubble");
  const [stake, setStake] = useState(500);
  const [code, setCode] = useState(makeCode());
  const [placed, setPlaced] = useState(false);
  const [balance, setBalance] = useState(1200000);
  const [openBets, setOpenBets] = useState(INITIAL_OPEN_BETS);
  const [settledBets, setSettledBets] = useState(SETTLED_BETS);
  const [notifs, setNotifs] = useState(NOTIFICATIONS);
  const [toast, setToast] = useState(null);

  const [wide, setWide] = useState(typeof window !== "undefined" ? window.innerWidth >= 1024 : true);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= 1024);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const notify = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }, []);

  const totalOdds = useMemo(() => slip.reduce((a, s) => a * s.odd, 1), [slip]);
  const payout = stake * totalOdds;
  const builderMatches = useMemo(() => {
    const c = {};
    slip.forEach((s) => (c[s.gameId] = (c[s.gameId] || 0) + 1));
    return Object.values(c).filter((n) => n > 1).length;
  }, [slip]);

  const pick = (game, market, outcome) => {
    setPlaced(false);
    const id = `${market.id}:${outcome.label}`;
    setSlip((prev) => {
      if (prev.some((p) => p.id === id)) return prev.filter((p) => p.id !== id);
      if (!prev.length) setSlipState("open");
      return [...prev.filter((p) => p.marketId !== market.id), {
        id, marketId: market.id, gameId: game.id,
        match: `${game.home} v ${game.away}`,
        market: market.name, label: outcome.label, odd: outcome.odd,
      }];
    });
    setCode(makeCode());
  };
  const isOn = (marketId, label) => slip.some((p) => p.id === `${marketId}:${label}`);

  const placeBet = () => {
    if (!slip.length || stake > balance || stake < 100) return;
    setBalance((b) => b - stake);
    setOpenBets((b) => [{
      id: "nb" + Date.now(), legs: slip.length, stake, odds: totalOdds,
      label: slip.length > 1 ? `${slip.length}-leg accumulator` : slip[0].label,
      status: "Just placed", code,
      picks: slip.map((s) => ({ pick: s.label, market: s.market, match: s.match, odd: s.odd, state: "open" })),
    }, ...b]);
    setPlaced(true);
  };
  const clearSlip = () => { setSlip([]); setPlaced(false); setSlipState("bubble"); setCode(makeCode()); };

  const cashOut = (bet, amount) => {
    setOpenBets((b) => b.filter((x) => x.id !== bet.id));
    setSettledBets((b) => [{ ...bet, result: "cashed out", payout: amount }, ...b]);
    setBalance((v) => v + amount);
    notify(`Cashed out ${naira(amount)}`);
    back();
  };
  const deposit = (amount) => { setBalance((b) => b + amount); notify(`${naira(amount)} added to your balance`); reset("wallet"); };
  const withdraw = (amount) => { setBalance((b) => b - amount); notify(`${naira(amount)} on the way — usually about three minutes`); reset("wallet"); };

  const slipProps = {
    slip, setSlip, totalOdds, payout, stake, setStake, balance, code, placed,
    builderMatches, clearSlip, placeBet, go, notify, collapse: () => setSlipState("bubble"),
  };
  const slipOpen = slipState === "open" && slip.length > 0;
  const nav = { go, back, reset };
  const unread = notifs.filter((n) => n.unread).length;

  const screen = () => {
    const p = { ...top, ...nav, pick, isOn, notify, balance };
    switch (top.name) {
      case "home": return <HomeScreen {...p} sport={sport} setSport={setSport} filter={filter} setFilter={setFilter} />;
      case "board": return <MarketBoard {...p} game={top.game} />;
      case "competition": return <CompetitionScreen {...p} league={top.league} />;
      case "featured": return <FeaturedScreen {...p} />;
      case "search": return <SearchScreen {...p} />;
      case "notifications": return <NotificationsScreen {...p} notifs={notifs} setNotifs={setNotifs} />;
      case "bets": return <MyBetsScreen {...p} openBets={openBets} settledBets={settledBets} />;
      case "betDetail": return <BetDetailScreen {...p} bet={top.bet} onCashOut={cashOut} />;
      case "codeResult": return <CodeResultScreen {...p} loadedCode={top.code} />;
      case "wallet": return <WalletScreen {...p} />;
      case "deposit": return <DepositScreen {...p} onDeposit={deposit} />;
      case "withdraw": return <WithdrawScreen {...p} onWithdraw={withdraw} />;
      case "transactions": return <TransactionsScreen {...p} />;
      case "banks": return <BanksScreen {...p} />;
      case "account": return <AccountScreen {...p} unread={unread} />;
      case "profile": return <ProfileScreen {...p} />;
      case "kyc": return <KycScreen {...p} />;
      case "limits": return <LimitsScreen {...p} />;
      case "settings": return <SettingsScreen {...p} />;
      case "help": return <HelpScreen {...p} />;
      case "terms": return <TermsScreen {...p} />;
      case "promotions": return <PromotionsScreen {...p} />;
      case "promoDetail": return <PromoDetailScreen {...p} promo={top.promo} />;
      case "virtuals": return <VirtualsScreen {...p} />;
      case "jackpot": return <JackpotScreen {...p} />;
      case "app": return <GetAppScreen {...p} />;
      default: return <HomeScreen {...p} sport={sport} setSport={setSport} filter={filter} setFilter={setFilter} />;
    }
  };

  return (
    <div className="min-h-screen w-full" style={{ background: C.bg, color: C.text, fontFamily: BODY }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap');
        @keyframes livepulse{0%,100%{opacity:1}50%{opacity:.25}}
        .live-dot{animation:livepulse 1.4s ease-in-out infinite}
        @keyframes slideup{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
        .slide{animation:slideup .22s cubic-bezier(.2,.7,.3,1)}
        @media (prefers-reduced-motion:reduce){.live-dot{animation:none}.slide{animation:none}}
        .no-bar::-webkit-scrollbar{display:none}.no-bar{scrollbar-width:none}
        .thin::-webkit-scrollbar{width:6px}
        .thin::-webkit-scrollbar-thumb{background:${C.line};border-radius:3px}
        :focus-visible{outline:2px solid ${C.accent};outline-offset:2px;border-radius:8px}
      `}</style>

      <Header balance={balance} unread={unread} go={go} reset={reset} />

      <div className="mx-auto flex w-full max-w-[1400px] gap-6 px-0 lg:px-6 lg:pt-5">
        <aside className="hidden w-52 shrink-0 lg:block">
          <div className="sticky top-[74px] space-y-0.5">
            {SPORTS.map((s) => (
              <button key={s.key}
                onClick={() => {
                  if (s.key === "Virtuals") return go("virtuals");
                  if (s.key === "Jackpot") return go("jackpot");
                  setSport(s.key); reset("home");
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm"
                style={{
                  background: sport === s.key && top.name === "home" ? C.accentWash : "transparent",
                  color: sport === s.key && top.name === "home" ? C.accentInk : C.dim,
                  fontWeight: sport === s.key ? 600 : 500,
                }}>
                {s.key === "Virtuals" ? <Dice5 size={15} color={C.muted} />
                  : s.key === "Jackpot" ? <Gift size={15} color={C.muted} />
                  : <Trophy size={15} color={sport === s.key && top.name === "home" ? C.accent : C.muted} />}
                {s.key}
              </button>
            ))}
            <div className="pt-5">
              <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-widest" style={{ color: C.muted }}>
                Competitions
              </div>
              {FIXTURES.map((l) => (
                <button key={l.id} onClick={() => go("competition", { league: l })}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm"
                  style={{ color: C.dim }}>
                  <span className="truncate">{l.league.split(" · ")[1]}</span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: C.muted }}>{l.games.length}</span>
                </button>
              ))}
            </div>
            <div className="pt-4">
              <button onClick={() => go("promotions")} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm" style={{ color: C.dim }}>
                <Gift size={15} color={C.muted} />Promotions
              </button>
              <button onClick={() => go("app")} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm" style={{ color: C.dim }}>
                <Smartphone size={15} color={C.muted} />Get the app
              </button>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 pb-32 lg:pb-10">{screen()}</main>

        {wide && slipOpen && (
          <aside className="slide hidden w-[330px] shrink-0 lg:block">
            <div className="thin sticky top-[74px] max-h-[calc(100vh-92px)] overflow-y-auto rounded-2xl"
              style={{ background: C.surface, border: `1px solid ${C.line}` }}>
              <SlipBody {...slipProps} />
            </div>
          </aside>
        )}
      </div>

      {slip.length > 0 && !slipOpen && (
        <button onClick={() => setSlipState("open")}
          className="slide fixed bottom-24 right-4 z-40 flex items-center gap-3 rounded-full py-2.5 pl-2.5 pr-5 lg:bottom-6 lg:right-6"
          style={{ background: C.accent, color: "#fff", boxShadow: "0 10px 30px rgba(217,72,15,.32)" }}
          aria-label={`Open bet slip, ${slip.length} selections`}>
          <span className="flex h-9 w-9 items-center justify-center rounded-full"
            style={{ background: "#fff", color: C.accent, fontFamily: MONO, fontWeight: 600, fontSize: 15 }}>
            {slip.length}
          </span>
          <span className="text-left leading-tight">
            <span className="block text-[10px] font-semibold uppercase tracking-wider" style={{ opacity: .85 }}>
              {builderMatches > 0 ? "Builder" : "Slip"}
            </span>
            <span className="block text-sm font-semibold" style={{ fontFamily: MONO }}>{totalOdds.toFixed(2)}</span>
          </span>
        </button>
      )}

      {!wide && slipOpen && (
        <div className="fixed inset-0 z-50 flex items-end" style={{ background: "rgba(26,22,20,.45)" }}
          onClick={() => setSlipState("bubble")}>
          <div className="slide max-h-[88vh] w-full overflow-y-auto rounded-t-3xl"
            style={{ background: C.surface }} onClick={(e) => e.stopPropagation()}>
            <SlipBody {...slipProps} />
          </div>
        </div>
      )}

      {toast && (
        <div className="slide fixed bottom-28 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-3 text-sm font-medium lg:bottom-6"
          style={{ background: C.text, color: "#fff", boxShadow: "0 10px 30px rgba(0,0,0,.25)" }}>
          {toast}
        </div>
      )}

      <BottomNav current={top.name} reset={reset} go={go} />
    </div>
  );
}

/* ================================================================== */
/* Primitives                                                          */
/* ================================================================== */

function LivePill({ minute, small }) {
  return (
    <span className={`flex shrink-0 items-center gap-1 rounded-md ${small ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-1 text-[10px]"} font-bold`}
      style={{ background: C.live, color: "#fff" }}>
      <span className="live-dot h-1.5 w-1.5 rounded-full" style={{ background: C.liveDot }} />
      {minute}'
    </span>
  );
}

function Page({ title, sub, back, children, action }) {
  return (
    <div className="px-4 pt-4 lg:px-0">
      <div className="mb-4 flex items-center gap-3">
        {back && (
          <button onClick={back} aria-label="Back" className="rounded-xl p-2"
            style={{ background: C.surface, border: `1px solid ${C.line}` }}><ChevronLeft size={18} /></button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl tracking-tight" style={{ fontFamily: DISPLAY, fontWeight: 800 }}>{title}</h1>
          {sub && <p className="mt-0.5 text-sm" style={{ color: C.muted }}>{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Card({ children, className = "", pad = true }) {
  return (
    <div className={`rounded-2xl ${pad ? "p-4" : ""} ${className}`}
      style={{ background: C.surface, border: `1px solid ${C.line}` }}>{children}</div>
  );
}

function ListRow({ icon: Icon, label, value, onClick, tone, last }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      style={{ borderBottom: last ? "none" : `1px solid ${C.lineSoft}` }}>
      {Icon && (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
          style={{ background: tone === "danger" ? C.dangerWash : C.raised }}>
          <Icon size={16} color={tone === "danger" ? C.danger : C.accent} />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-sm font-medium"
        style={{ color: tone === "danger" ? C.danger : C.text }}>{label}</span>
      {value && <span className="shrink-0 text-sm" style={{ color: C.muted, fontFamily: MONO }}>{value}</span>}
      <ChevronRight size={16} color={C.muted} />
    </button>
  );
}

function Btn({ children, onClick, variant = "primary", disabled, full = true, icon: Icon }) {
  const styles = {
    primary: { background: disabled ? C.raised : C.accent, color: disabled ? C.muted : "#fff" },
    ghost: { background: C.surface, color: C.text, border: `1px solid ${C.line}` },
    soft: { background: C.accentWash, color: C.accentInk },
    money: { background: C.moneyWash, color: C.money },
    danger: { background: C.dangerWash, color: C.danger },
  }[variant];
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-semibold ${full ? "w-full" : "px-5"}`}
      style={styles}>{Icon && <Icon size={16} strokeWidth={2.5} />}{children}</button>
  );
}

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold" style={{ color: C.dim }}>{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[11px]" style={{ color: C.muted }}>{hint}</span>}
    </label>
  );
}

const inputStyle = {
  background: C.raised, border: `1px solid ${C.line}`, borderRadius: 12,
  padding: "12px 14px", width: "100%", fontSize: 15, outline: "none", color: C.text,
};

function Empty({ icon: Icon, title, body }) {
  return (
    <div className="py-16 text-center">
      <Icon size={26} color={C.muted} className="mx-auto mb-3" />
      <p className="text-sm font-semibold">{title}</p>
      <p className="mx-auto mt-1.5 max-w-xs text-sm" style={{ color: C.muted }}>{body}</p>
    </div>
  );
}

/* ================================================================== */

function Header({ balance, unread, go, reset }) {
  return (
    <header className="sticky top-0 z-30" style={{ background: C.surface, borderBottom: `1px solid ${C.line}` }}>
      <div className="mx-auto flex w-full max-w-[1400px] items-center gap-4 px-4 py-3 lg:px-6">
        <button onClick={() => reset("home")} className="flex shrink-0 items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: C.accent }}>
            <Zap size={17} strokeWidth={2.6} color="#fff" />
          </div>
          <span className="text-xl tracking-tight" style={{ fontFamily: DISPLAY, fontWeight: 800 }}>
            {BRAND.first}<span style={{ color: C.accent }}>{BRAND.second}</span>
          </span>
        </button>

        <button onClick={() => go("search")}
          className="hidden flex-1 items-center gap-2 rounded-xl px-3.5 py-2.5 text-left lg:flex"
          style={{ background: C.raised, maxWidth: 400 }}>
          <Search size={15} color={C.muted} />
          <span className="text-sm" style={{ color: C.muted }}>Search teams or competitions</span>
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => go("wallet")} className="flex items-center gap-2.5 rounded-full py-1.5 pl-4 pr-1.5"
            style={{ background: C.raised, border: `1px solid ${C.line}` }} aria-label="Balance and wallet">
            <span className="whitespace-nowrap text-sm font-semibold" style={{ fontFamily: MONO }}>{naira(balance)}</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: C.accent }}>
              <Plus size={15} strokeWidth={3} color="#fff" />
            </span>
          </button>
          <button onClick={() => go("search")} className="rounded-xl p-2 lg:hidden" style={{ background: C.raised }} aria-label="Search">
            <Search size={17} color={C.muted} />
          </button>
          <button onClick={() => go("notifications")} className="relative rounded-xl p-2" style={{ background: C.raised }} aria-label="Notifications">
            <Bell size={17} color={C.muted} />
            {unread > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold"
                style={{ background: C.accent, color: "#fff" }}>{unread}</span>
            )}
          </button>
          <button onClick={() => go("account")} className="rounded-xl p-2" style={{ background: C.raised }} aria-label="Account">
            <User size={17} color={C.muted} />
          </button>
        </div>
      </div>
    </header>
  );
}

/* ================================================================== */

function HomeScreen({ sport, setSport, filter, setFilter, go, pick, isOn }) {
  const data = SPORTS.find((s) => s.key === sport)?.data ?? FIXTURES;
  const visible = useMemo(() => {
    if (filter !== "Live") return data;
    return data.map((l) => ({ ...l, games: l.games.filter((g) => g.live) })).filter((l) => l.games.length);
  }, [data, filter]);

  return (
    <>
      <FeaturedRail games={FEATURED} isOn={isOn} pick={pick} go={go} />

      <nav className="no-bar mt-5 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden">
        {SPORTS.map((s) => (
          <button key={s.key}
            onClick={() => {
              if (s.key === "Virtuals") return go("virtuals");
              if (s.key === "Jackpot") return go("jackpot");
              setSport(s.key);
            }}
            className="shrink-0 rounded-full px-4 py-2 text-sm"
            style={{
              background: sport === s.key ? C.accent : C.surface,
              color: sport === s.key ? "#fff" : C.dim,
              fontWeight: sport === s.key ? 600 : 500,
              border: `1px solid ${sport === s.key ? C.accent : C.line}`,
            }}>{s.key}</button>
        ))}
      </nav>

      <div className="no-bar mt-4 flex gap-6 overflow-x-auto px-4 lg:px-0">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} className="shrink-0 pb-2.5 text-sm"
            style={{
              color: filter === f ? C.text : C.muted, fontWeight: filter === f ? 600 : 500,
              borderBottom: `2px solid ${filter === f ? C.accent : "transparent"}`,
            }}>
            {f === "Live" && <span className="live-dot mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: C.liveDot }} />}
            {f}
          </button>
        ))}
      </div>
      <div style={{ height: 1, background: C.line }} />

      <div className="px-3 lg:px-0">
        {visible.length ? visible.map((lg) => (
          <LeagueTable key={lg.id} lg={lg} isOn={isOn} pick={pick} go={go} />
        )) : <Empty icon={Clock} title="Nothing live right now" body="Switch to Today to see the next matches kicking off." />}
      </div>
    </>
  );
}

function FeaturedRail({ games, isOn, pick, go }) {
  return (
    <section className="pt-4">
      <div className="mb-2.5 flex items-center justify-between px-4 lg:px-0">
        <div className="flex items-center gap-2">
          <Flame size={15} color={C.accent} />
          <h2 className="text-[15px]" style={{ fontFamily: DISPLAY, fontWeight: 700 }}>Main matches</h2>
        </div>
        <button onClick={() => go("featured")} className="flex items-center gap-0.5 text-xs font-semibold"
          style={{ color: C.accentInk }}>See all <ChevronRight size={13} /></button>
      </div>
      <div className="no-bar flex gap-3 overflow-x-auto px-4 pb-1 lg:px-0">
        {games.map((g) => <FeaturedCard key={g.id} g={g} isOn={isOn} pick={pick} go={go} />)}
      </div>
    </section>
  );
}

function FeaturedCard({ g, isOn, pick, go }) {
  const main = { id: `${g.id}:main:1X2`, name: "1X2" };
  return (
    <article className="w-[270px] shrink-0 overflow-hidden rounded-2xl"
      style={{ background: C.surface, border: `1px solid ${C.line}` }}>
      <button onClick={() => go("board", { game: g })} className="w-full px-4 pb-3 pt-3.5 text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.muted }}>
            {g.league?.split(" · ")[1]}
          </span>
          {g.live ? <LivePill minute={g.minute} small />
            : <span className="text-[11px]" style={{ color: C.muted, fontFamily: MONO }}>{g.time}</span>}
        </div>
        <div className="mt-3 space-y-1.5">
          {[[g.home, g.hs], [g.away, g.as]].map(([team, score]) => (
            <div key={team} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{team}</span>
              {g.live && <span className="text-[15px]" style={{ fontFamily: MONO, fontWeight: 600 }}>{score}</span>}
            </div>
          ))}
        </div>
      </button>
      <div className="flex gap-1.5 px-4 pb-4">
        {["1", "X", "2"].map((kk) => {
          const on = isOn(main.id, kk);
          return (
            <button key={kk} onClick={() => pick(g, main, { label: kk, odd: g.odds[kk] })}
              className="flex flex-1 flex-col items-center rounded-lg py-2"
              style={{ background: on ? C.accent : C.raised, color: on ? "#fff" : C.text }} aria-pressed={on}>
              <span className="text-[10px] font-semibold" style={{ color: on ? "rgba(255,255,255,.85)" : C.muted }}>{kk}</span>
              <span className="text-[14px]" style={{ fontFamily: MONO, fontWeight: 600 }}>{g.odds[kk].toFixed(2)}</span>
            </button>
          );
        })}
      </div>
    </article>
  );
}

function LeagueTable({ lg, isOn, pick, go }) {
  return (
    <section className="mt-5">
      <div className="mb-1.5 flex items-center gap-3 px-1">
        <button onClick={() => go("competition", { league: lg })} className="flex min-w-0 flex-1 items-center gap-1 text-left">
          <h2 className="truncate text-[13px] font-semibold" style={{ fontFamily: DISPLAY, color: C.dim }}>{lg.league}</h2>
          <ChevronRight size={13} color={C.muted} />
        </button>
        <div className="flex shrink-0 gap-1.5" style={{ width: "min(46vw, 232px)" }}>
          {["1", "X", "2"].map((h) => (
            <span key={h} className="flex-1 text-center text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: C.muted }}>{h}</span>
          ))}
        </div>
        <span className="w-9" />
      </div>
      <div className="overflow-hidden rounded-2xl" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
        {lg.games.map((g, i) => (
          <FixtureRow key={g.id} g={g} first={i === 0} isOn={isOn} pick={pick} go={go} />
        ))}
      </div>
    </section>
  );
}

function FixtureRow({ g, first, isOn, pick, go }) {
  const marketCount = useMemo(() => buildBoard(g).length, [g]);
  const main = { id: `${g.id}:main:1X2`, name: "1X2" };
  return (
    <div className="flex items-center gap-3 px-3 py-3" style={{ borderTop: first ? "none" : `1px solid ${C.lineSoft}` }}>
      <button onClick={() => go("board", { game: g })} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <span className="w-[44px] shrink-0">
          {g.live ? <LivePill minute={g.minute} small />
            : <span className="text-[11px]" style={{ color: C.muted, fontFamily: MONO }}>{g.time}</span>}
        </span>
        <span className="min-w-0 flex-1 space-y-0.5">
          {[[g.home, g.hs], [g.away, g.as]].map(([team, score]) => (
            <span key={team} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-snug">{team}</span>
              {g.live && <span className="shrink-0 text-[13px] leading-snug" style={{ fontFamily: MONO, fontWeight: 600 }}>{score}</span>}
            </span>
          ))}
        </span>
      </button>
      <div className="flex shrink-0 gap-1.5" style={{ width: "min(46vw, 232px)" }}>
        {["1", "X", "2"].map((kk) => {
          const on = isOn(main.id, kk);
          return (
            <button key={kk} onClick={() => pick(g, main, { label: kk, odd: g.odds[kk] })}
              className="flex-1 rounded-lg py-2.5 text-[13px]"
              style={{ background: on ? C.accent : C.raised, color: on ? "#fff" : C.text, fontFamily: MONO, fontWeight: 600 }}
              aria-pressed={on}>{g.odds[kk].toFixed(2)}</button>
          );
        })}
      </div>
      <button onClick={() => go("board", { game: g })} className="w-9 shrink-0 rounded-lg py-2.5 text-[11px]"
        style={{ background: C.raised, color: C.dim, fontFamily: MONO }}>+{marketCount}</button>
    </div>
  );
}

/* ================================================================== */

function MarketBoard({ game, back, pick, isOn }) {
  const markets = useMemo(() => buildBoard(game), [game]);
  const [group, setGroup] = useState("main");
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState({});
  const groupsPresent = GROUPS.filter((gr) => markets.some((m) => m.group === gr.key));
  const shown = useMemo(() => {
    if (q.trim()) return markets.filter((m) => m.name.toLowerCase().includes(q.toLowerCase()));
    return markets.filter((m) => m.group === group);
  }, [markets, group, q]);

  return (
    <div>
      <header className="sticky top-[65px] z-20" style={{ background: C.bg, borderBottom: `1px solid ${C.line}` }}>
        <div className="flex items-center gap-3 px-4 pt-4 pb-3 lg:px-0">
          <button onClick={back} aria-label="Back" className="rounded-xl p-2"
            style={{ background: C.surface, border: `1px solid ${C.line}` }}><ChevronLeft size={18} /></button>
          <div className="min-w-0 flex-1">
            {[[game.home, game.hs], [game.away, game.as]].map(([t, s]) => (
              <div key={t} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-snug">{t}</span>
                {game.live && <span style={{ fontFamily: MONO, fontWeight: 600 }}>{s}</span>}
              </div>
            ))}
            <div className="mt-1">
              {game.live ? <LivePill minute={game.minute} small />
                : <span className="text-[11px]" style={{ color: C.muted, fontFamily: MONO }}>{game.time}</span>}
            </div>
          </div>
          <span className="shrink-0 rounded-lg px-2.5 py-1 text-[11px]"
            style={{ background: C.surface, color: C.muted, fontFamily: MONO, border: `1px solid ${C.line}` }}>
            {markets.length} markets
          </span>
        </div>
        <div className="px-4 pb-3 lg:px-0">
          <div className="flex items-center gap-2 rounded-xl px-3.5 py-2.5" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
            <Search size={15} color={C.muted} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search markets"
              className="flex-1 bg-transparent text-sm outline-none" />
            {q && <button onClick={() => setQ("")} aria-label="Clear"><X size={14} color={C.muted} /></button>}
          </div>
        </div>
        {!q && (
          <div className="no-bar flex gap-5 overflow-x-auto px-4 lg:px-0">
            {groupsPresent.map((gr) => (
              <button key={gr.key} onClick={() => setGroup(gr.key)} className="shrink-0 pb-2.5 text-sm"
                style={{
                  color: group === gr.key ? C.text : C.muted, fontWeight: group === gr.key ? 600 : 500,
                  borderBottom: `2px solid ${group === gr.key ? C.accent : "transparent"}`,
                }}>{gr.label}</button>
            ))}
          </div>
        )}
      </header>

      <div className="space-y-2 px-4 py-4 lg:columns-2 lg:gap-3 lg:space-y-0 lg:px-0">
        {shown.map((m) => {
          const open = !collapsed[m.id];
          return (
            <section key={m.id} className="mb-3 break-inside-avoid rounded-2xl"
              style={{ background: C.surface, border: `1px solid ${C.line}` }}>
              <button onClick={() => setCollapsed((c) => ({ ...c, [m.id]: open }))}
                className="flex w-full items-center justify-between px-4 py-3 text-left" aria-expanded={open}>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{m.name}</div>
                  {m.note && <div className="mt-0.5 text-[11px]" style={{ color: C.muted }}>{m.note}</div>}
                </div>
                <ChevronDown size={16} color={C.muted} style={{ transform: open ? "none" : "rotate(-90deg)", transition: "transform .15s" }} />
              </button>
              {open && (
                <div className="grid grid-cols-3 gap-2 px-4 pb-4">
                  {m.outcomes.map((o) => {
                    const on = isOn(m.id, o.label);
                    return (
                      <button key={o.label} onClick={() => pick(game, m, o)}
                        className="flex flex-col items-center justify-center rounded-xl px-1 py-2.5"
                        style={{ background: on ? C.accent : C.raised, color: on ? "#fff" : C.text }} aria-pressed={on}>
                        <span className="w-full truncate text-center text-[10px]"
                          style={{ color: on ? "rgba(255,255,255,.85)" : C.muted }}>{o.label}</span>
                        <span className="text-[14px]" style={{ fontFamily: MONO, fontWeight: 600 }}>{o.odd.toFixed(2)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
        {!shown.length && <Empty icon={Search} title="No markets match" body="Try a shorter term like corners or over." />}
      </div>
    </div>
  );
}

/* ================================================================== */

function CompetitionScreen({ league, back, go, pick, isOn }) {
  return (
    <Page title={league.league.split(" · ")[1]} sub={league.league.split(" · ")[0]} back={back}>
      <div className="mb-1.5 flex items-center gap-3 px-1">
        <span className="min-w-0 flex-1" />
        <div className="flex shrink-0 gap-1.5" style={{ width: "min(46vw, 232px)" }}>
          {["1", "X", "2"].map((h) => (
            <span key={h} className="flex-1 text-center text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.muted }}>{h}</span>
          ))}
        </div>
        <span className="w-9" />
      </div>
      <div className="overflow-hidden rounded-2xl" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
        {league.games.map((g, i) => <FixtureRow key={g.id} g={g} first={i === 0} isOn={isOn} pick={pick} go={go} />)}
      </div>
    </Page>
  );
}

function FeaturedScreen({ back, go, pick, isOn }) {
  return (
    <Page title="Main matches" sub="The games drawing the most action today." back={back}>
      <div className="grid gap-3 sm:grid-cols-2">
        {FEATURED.map((g) => <FeaturedCardWide key={g.id} g={g} isOn={isOn} pick={pick} go={go} />)}
      </div>
    </Page>
  );
}

function FeaturedCardWide({ g, isOn, pick, go }) {
  const main = { id: `${g.id}:main:1X2`, name: "1X2" };
  return (
    <Card pad={false}>
      <button onClick={() => go("board", { game: g })} className="w-full px-4 pb-3 pt-4 text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.muted }}>
            {g.league?.split(" · ")[1]}
          </span>
          {g.live ? <LivePill minute={g.minute} small />
            : <span className="text-[11px]" style={{ color: C.muted, fontFamily: MONO }}>{g.time}</span>}
        </div>
        <div className="mt-3 space-y-1.5">
          {[[g.home, g.hs], [g.away, g.as]].map(([t, s]) => (
            <div key={t} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{t}</span>
              {g.live && <span style={{ fontFamily: MONO, fontWeight: 600 }}>{s}</span>}
            </div>
          ))}
        </div>
      </button>
      <div className="flex gap-1.5 px-4 pb-4">
        {["1", "X", "2"].map((kk) => {
          const on = isOn(main.id, kk);
          return (
            <button key={kk} onClick={() => pick(g, main, { label: kk, odd: g.odds[kk] })}
              className="flex flex-1 flex-col items-center rounded-lg py-2"
              style={{ background: on ? C.accent : C.raised, color: on ? "#fff" : C.text }}>
              <span className="text-[10px] font-semibold" style={{ color: on ? "rgba(255,255,255,.85)" : C.muted }}>{kk}</span>
              <span className="text-[14px]" style={{ fontFamily: MONO, fontWeight: 600 }}>{g.odds[kk].toFixed(2)}</span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function SearchScreen({ back, go, pick, isOn }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    if (q.trim().length < 2) return [];
    const t = q.toLowerCase();
    return ALL_GAMES.filter((g) =>
      g.home.toLowerCase().includes(t) || g.away.toLowerCase().includes(t) || g.league.toLowerCase().includes(t));
  }, [q]);

  return (
    <Page title="Search" back={back}>
      <div className="flex items-center gap-2 rounded-xl px-3.5 py-3" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
        <Search size={16} color={C.muted} />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Team or competition"
          className="flex-1 bg-transparent text-sm outline-none" />
        {q && <button onClick={() => setQ("")} aria-label="Clear"><X size={15} color={C.muted} /></button>}
      </div>

      {q.trim().length < 2 ? (
        <div className="mt-5">
          <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider" style={{ color: C.muted }}>Popular</p>
          <div className="flex flex-wrap gap-2">
            {["Arsenal", "Enyimba", "Real Madrid", "Premier League", "NPFL"].map((s) => (
              <button key={s} onClick={() => setQ(s)} className="rounded-full px-3.5 py-2 text-sm"
                style={{ background: C.surface, border: `1px solid ${C.line}`, color: C.dim }}>{s}</button>
            ))}
          </div>
        </div>
      ) : results.length ? (
        <div className="mt-4 overflow-hidden rounded-2xl" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
          {results.map((g, i) => <FixtureRow key={g.id} g={g} first={i === 0} isOn={isOn} pick={pick} go={go} />)}
        </div>
      ) : <Empty icon={Search} title="Nothing found" body={`No matches for "${q}". Check the spelling or try the competition name.`} />}
    </Page>
  );
}

/* ================================================================== */

function NotificationsScreen({ back, notifs, setNotifs, go }) {
  return (
    <Page title="Notifications" back={back}
      action={<button onClick={() => setNotifs((n) => n.map((x) => ({ ...x, unread: false })))}
        className="shrink-0 text-xs font-semibold" style={{ color: C.accentInk }}>Mark all read</button>}>
      {notifs.length ? (
        <div className="overflow-hidden rounded-2xl" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
          {notifs.map((n, i) => (
            <button key={n.id}
              onClick={() => {
                setNotifs((s) => s.map((x) => (x.id === n.id ? { ...x, unread: false } : x)));
                if (n.kind === "win") go("bets");
                else if (n.kind === "wallet") go("transactions");
                else if (n.kind === "promo") go("promotions");
                else go("home");
              }}
              className="flex w-full items-start gap-3 px-4 py-3.5 text-left"
              style={{ borderTop: i ? `1px solid ${C.lineSoft}` : "none", background: n.unread ? C.accentWash : "transparent" }}>
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: C.raised }}>
                {n.kind === "win" ? <Trophy size={14} color={C.money} />
                  : n.kind === "promo" ? <Gift size={14} color={C.accent} />
                  : n.kind === "wallet" ? <Banknote size={14} color={C.money} />
                  : <Clock size={14} color={C.muted} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{n.title}</span>
                <span className="mt-0.5 block text-sm" style={{ color: C.dim }}>{n.body}</span>
              </span>
              <span className="shrink-0 text-[11px]" style={{ color: C.muted }}>{n.at}</span>
            </button>
          ))}
        </div>
      ) : <Empty icon={Bell} title="Nothing new" body="Wins, payouts and kick-off reminders land here." />}
    </Page>
  );
}

/* ================================================================== */

function MyBetsScreen({ back, go, openBets, settledBets, notify }) {
  const [tab, setTab] = useState("open");
  const [codeInput, setCodeInput] = useState("");
  const list = tab === "open" ? openBets : settledBets;

  return (
    <Page title="My bets" back={back}>
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <Ticket size={16} color={C.accent} />
          <span className="text-sm font-semibold">Load a booking code</span>
        </div>
        <div className="flex gap-2">
          <input value={codeInput} onChange={(e) => setCodeInput(e.target.value.toUpperCase())} maxLength={6}
            placeholder="6-character code" className="min-w-0 flex-1"
            style={{ ...inputStyle, borderStyle: "dashed", fontFamily: MONO, fontWeight: 600, letterSpacing: ".16em" }} />
          <button onClick={() => codeInput.length === 6 ? go("codeResult", { code: codeInput }) : notify("Enter all six characters")}
            className="shrink-0 rounded-xl px-5 text-sm font-semibold" style={{ background: C.accent, color: "#fff" }}>Load</button>
        </div>
        <p className="mt-2.5 text-xs" style={{ color: C.muted }}>
          Codes last 72 hours. Load one, swap the legs you disagree with, then rebook it as your own.
        </p>
      </Card>

      <div className="mt-6 flex gap-6" style={{ borderBottom: `1px solid ${C.line}` }}>
        {[["open", `Open (${openBets.length})`], ["settled", "Settled"]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className="pb-2.5 text-sm"
            style={{
              color: tab === k ? C.text : C.muted, fontWeight: tab === k ? 600 : 500,
              borderBottom: `2px solid ${tab === k ? C.accent : "transparent"}`,
            }}>{label}</button>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        {list.length ? list.map((b) => (
          <button key={b.id} onClick={() => go("betDetail", { bet: b })} className="block w-full text-left">
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{b.label}</div>
                  <div className="mt-0.5 text-xs" style={{ color: C.muted }}>
                    {b.legs} leg{b.legs > 1 ? "s" : ""} · {naira(b.stake)} at {b.odds.toFixed(2)}
                  </div>
                </div>
                <span className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold"
                  style={{
                    background: b.result === "won" ? C.moneyWash : b.result === "lost" ? C.raised : C.accentWash,
                    color: b.result === "won" ? C.money : b.result === "lost" ? C.muted : C.accentInk,
                  }}>{b.result ?? b.status}</span>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs" style={{ color: C.muted }}>{b.result ? "Returned" : "Potential"}</span>
                <span style={{ fontFamily: MONO, fontWeight: 600, color: b.result === "lost" ? C.muted : C.money }}>
                  {naira(b.result ? b.payout : Math.round(b.stake * b.odds))}
                </span>
              </div>
            </Card>
          </button>
        )) : (
          <Empty icon={Receipt} title={tab === "open" ? "No open bets" : "Nothing settled yet"}
            body={tab === "open" ? "Tap any odds to start a slip." : "Settled tickets appear here with the stats they were settled on."} />
        )}
      </div>
    </Page>
  );
}

function BetDetailScreen({ bet, back, onCashOut, notify }) {
  const cashValue = Math.round(bet.stake * bet.odds * 0.34);
  const [confirming, setConfirming] = useState(false);

  return (
    <Page title={bet.label} sub={`${bet.legs} leg${bet.legs > 1 ? "s" : ""} · ${naira(bet.stake)} at ${bet.odds.toFixed(2)}`} back={back}>
      <Card pad={false}>
        {bet.picks?.map((p, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3.5" style={{ borderTop: i ? `1px solid ${C.lineSoft}` : "none" }}>
            <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
              style={{ background: p.state === "won" ? C.moneyWash : p.state === "lost" ? C.dangerWash : C.raised }}>
              {p.state === "won" ? <Check size={11} color={C.money} strokeWidth={3} />
                : p.state === "lost" ? <X size={11} color={C.danger} strokeWidth={3} />
                : <Clock size={11} color={C.muted} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{p.pick}</div>
              <div className="mt-0.5 truncate text-xs" style={{ color: C.dim }}>{p.market}</div>
              <div className="mt-0.5 truncate text-[11px]" style={{ color: C.muted }}>{p.match}</div>
            </div>
            <span style={{ fontFamily: MONO, fontWeight: 600, color: C.text }}>{p.odd.toFixed(2)}</span>
          </div>
        ))}
      </Card>

      <Card className="mt-3">
        <div className="space-y-2 text-sm">
          <Row label="Stake" value={naira(bet.stake)} />
          <Row label="Total odds" value={bet.odds.toFixed(2)} />
          <Row label={bet.result ? "Returned" : "Potential winnings"}
            value={naira(bet.result ? bet.payout : Math.round(bet.stake * bet.odds))} money />
          <Row label="Booking code" value={bet.code} />
        </div>
      </Card>

      {!bet.result && (
        <div className="mt-3 space-y-2">
          {confirming ? (
            <Card>
              <p className="text-sm font-semibold">Cash out {naira(cashValue)}?</p>
              <p className="mt-1 text-sm" style={{ color: C.muted }}>
                This closes the bet now. You give up {naira(Math.round(bet.stake * bet.odds) - cashValue)} of
                potential winnings in exchange for certainty. The offer expires in a few seconds.
              </p>
              <div className="mt-3 flex gap-2">
                <Btn onClick={() => onCashOut(bet, cashValue)}>Confirm</Btn>
                <Btn variant="ghost" onClick={() => setConfirming(false)}>Cancel</Btn>
              </div>
            </Card>
          ) : <Btn variant="money" onClick={() => setConfirming(true)}>Cash out {naira(cashValue)}</Btn>}
          <Btn variant="ghost" icon={Share2} onClick={() => notify(`Code ${bet.code} copied`)}>Share this slip</Btn>
        </div>
      )}
    </Page>
  );
}

function CodeResultScreen({ loadedCode, back, go, notify }) {
  const known = ["K7M2QX", "H4RM0N"].includes(loadedCode);
  const legs = [
    { pick: "Arsenal", market: "1X2", match: "Arsenal v Chelsea", odd: 1.42 },
    { pick: "Over 2.5", market: "Total goals", match: "Man Utd v Liverpool", odd: 1.86 },
    { pick: "Both teams to score — Yes", market: "BTTS", match: "Real Madrid v Sevilla", odd: 1.72 },
  ];
  const total = legs.reduce((a, l) => a * l.odd, 1);

  if (!known) {
    return (
      <Page title="Booking code" back={back}>
        <Empty icon={AlertTriangle} title={`${loadedCode} not found`}
          body="That code has expired or does not exist. Codes last 72 hours — ask for a fresh one." />
        <Btn variant="ghost" onClick={back}>Try another code</Btn>
      </Page>
    );
  }

  return (
    <Page title={loadedCode} sub={`${legs.length} selections · ${total.toFixed(2)}`} back={back}>
      <Card pad={false}>
        {legs.map((l, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3.5" style={{ borderTop: i ? `1px solid ${C.lineSoft}` : "none" }}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{l.pick}</div>
              <div className="mt-0.5 truncate text-xs" style={{ color: C.dim }}>{l.market}</div>
              <div className="mt-0.5 truncate text-[11px]" style={{ color: C.muted }}>{l.match}</div>
            </div>
            <span style={{ fontFamily: MONO, fontWeight: 600 }}>{l.odd.toFixed(2)}</span>
          </div>
        ))}
      </Card>
      <div className="mt-3 space-y-2">
        <Btn onClick={() => { notify("Loaded into your slip"); go("home"); }}>Load into my slip</Btn>
        <Btn variant="ghost" onClick={back}>Cancel</Btn>
      </div>
    </Page>
  );
}

/* ================================================================== */

function WalletScreen({ balance, back, go }) {
  const cards = [
    { label: "Withdrawable", value: balance, tone: C.money },
    { label: "Bonus", value: 2500, tone: C.accentInk },
    { label: "On open bets", value: 3200, tone: C.dim },
  ];
  return (
    <Page title="Wallet" sub="Deposits reflect instantly. Withdrawals clear in about three minutes." back={back}>
      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label} className="p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.muted }}>{c.label}</div>
            <div className="mt-2 text-xl" style={{ fontFamily: MONO, fontWeight: 600, color: c.tone }}>{naira(c.value)}</div>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Btn icon={ArrowDownLeft} onClick={() => go("deposit")}>Deposit</Btn>
        <Btn icon={ArrowUpRight} variant="ghost" onClick={() => go("withdraw")}>Withdraw</Btn>
      </div>

      <button onClick={() => go("kyc")} className="mt-4 block w-full text-left">
        <div className="flex items-start gap-3 rounded-2xl p-4" style={{ background: C.accentWash, border: `1px solid ${C.line}` }}>
          <Shield size={17} color={C.accent} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1 text-sm" style={{ color: C.dim }}>
            <span className="font-semibold" style={{ color: C.text }}>Tier 1 verified.</span>{" "}
            You can withdraw up to ₦50,000 a day. Add your BVN to raise it.
          </div>
          <ChevronRight size={16} color={C.muted} />
        </div>
      </button>

      <Card className="mt-4" pad={false}>
        <ListRow icon={Building2} label="Bank accounts" value={`${BANKS.length}`} onClick={() => go("banks")} />
        <ListRow icon={Receipt} label="Transaction history" onClick={() => go("transactions")} />
        <ListRow icon={SlidersHorizontal} label="Deposit and loss limits" onClick={() => go("limits")} last />
      </Card>
    </Page>
  );
}

function DepositScreen({ back, onDeposit, notify }) {
  const [amount, setAmount] = useState(5000);
  const [method, setMethod] = useState("opay");
  const methods = [
    { id: "opay", label: "OPay", note: "Instant" },
    { id: "palmpay", label: "PalmPay", note: "Instant" },
    { id: "transfer", label: "Bank transfer", note: "1–2 minutes" },
    { id: "card", label: "Debit card", note: "Instant" },
    { id: "ussd", label: "USSD", note: "Dial and confirm" },
  ];
  return (
    <Page title="Deposit" sub="Minimum ₦100. No fee on any method." back={back}>
      <Card>
        <Field label="Amount">
          <div className="flex items-center rounded-xl px-3.5 py-3" style={{ background: C.raised, border: `1px solid ${C.line}` }}>
            <span style={{ color: C.muted, fontFamily: MONO }}>₦</span>
            <input type="number" value={amount} onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
              className="w-full bg-transparent px-2 text-lg outline-none" style={{ fontFamily: MONO, fontWeight: 600 }} />
          </div>
        </Field>
        <div className="mt-2 flex gap-2">
          {[1000, 5000, 10000, 50000].map((v) => (
            <button key={v} onClick={() => setAmount(v)} className="flex-1 rounded-xl py-2 text-xs"
              style={{
                background: amount === v ? C.accentWash : C.raised,
                color: amount === v ? C.accentInk : C.muted, fontFamily: MONO, fontWeight: 600,
              }}>{v >= 1000 ? `${v / 1000}k` : v}</button>
          ))}
        </div>
      </Card>

      <p className="mb-2 mt-5 text-[12px] font-semibold uppercase tracking-wider" style={{ color: C.muted }}>Pay with</p>
      <Card pad={false}>
        {methods.map((m, i) => (
          <button key={m.id} onClick={() => setMethod(m.id)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
            style={{ borderTop: i ? `1px solid ${C.lineSoft}` : "none" }}>
            <span className="flex h-5 w-5 items-center justify-center rounded-full"
              style={{ border: `2px solid ${method === m.id ? C.accent : C.line}`, background: method === m.id ? C.accent : "transparent" }}>
              {method === m.id && <Check size={11} color="#fff" strokeWidth={3} />}
            </span>
            <span className="flex-1 text-sm font-medium">{m.label}</span>
            <span className="text-xs" style={{ color: C.muted }}>{m.note}</span>
          </button>
        ))}
      </Card>

      <div className="mt-4">
        <Btn disabled={amount < 100} onClick={() => amount >= 100 ? onDeposit(amount) : notify("Minimum deposit is ₦100")}>
          Deposit {naira(amount)}
        </Btn>
      </div>
    </Page>
  );
}

function WithdrawScreen({ balance, back, onWithdraw, go }) {
  const [amount, setAmount] = useState(5000);
  const [bank, setBank] = useState(BANKS[0].id);
  const tooMuch = amount > balance;
  const overTier = amount > 50000;

  return (
    <Page title="Withdraw" sub="Tier 1 limit is ₦50,000 a day. No withdrawal fee." back={back}>
      <Card>
        <Field label="Amount" hint={`Withdrawable: ${naira(balance)}`}>
          <div className="flex items-center rounded-xl px-3.5 py-3" style={{ background: C.raised, border: `1px solid ${C.line}` }}>
            <span style={{ color: C.muted, fontFamily: MONO }}>₦</span>
            <input type="number" value={amount} onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
              className="w-full bg-transparent px-2 text-lg outline-none" style={{ fontFamily: MONO, fontWeight: 600 }} />
          </div>
        </Field>
      </Card>

      <p className="mb-2 mt-5 text-[12px] font-semibold uppercase tracking-wider" style={{ color: C.muted }}>Send to</p>
      <Card pad={false}>
        {BANKS.map((b, i) => (
          <button key={b.id} onClick={() => setBank(b.id)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
            style={{ borderTop: i ? `1px solid ${C.lineSoft}` : "none" }}>
            <span className="flex h-5 w-5 items-center justify-center rounded-full"
              style={{ border: `2px solid ${bank === b.id ? C.accent : C.line}`, background: bank === b.id ? C.accent : "transparent" }}>
              {bank === b.id && <Check size={11} color="#fff" strokeWidth={3} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{b.name}</span>
              <span className="block text-xs" style={{ color: C.muted, fontFamily: MONO }}>{b.acct}</span>
            </span>
            {b.verified && <BadgeCheck size={15} color={C.money} />}
          </button>
        ))}
        <ListRow icon={Plus} label="Add a bank account" onClick={() => go("banks")} last />
      </Card>

      {overTier && (
        <div className="mt-3 flex items-start gap-2.5 rounded-xl p-3.5" style={{ background: C.warnWash }}>
          <AlertTriangle size={15} color={C.warn} className="mt-0.5 shrink-0" />
          <span className="text-xs" style={{ color: C.dim }}>
            Above your ₦50,000 daily tier limit. Add your BVN to raise it to ₦500,000.
          </span>
        </div>
      )}

      <div className="mt-4">
        <Btn disabled={tooMuch || overTier || amount < 500} onClick={() => onWithdraw(amount)}>
          {tooMuch ? "Not enough balance" : `Withdraw ${naira(amount)}`}
        </Btn>
        <p className="mt-2.5 text-center text-[11px]" style={{ color: C.muted }}>Minimum withdrawal is ₦500.</p>
      </div>
    </Page>
  );
}

function TransactionsScreen({ back }) {
  const [f, setF] = useState("all");
  const list = TRANSACTIONS.filter((t) => f === "all" ? true : f === "in" ? t.amount > 0 : t.amount < 0);
  return (
    <Page title="Transactions" back={back}>
      <div className="mb-4 flex gap-2">
        {[["all", "All"], ["in", "Money in"], ["out", "Money out"]].map(([k, l]) => (
          <button key={k} onClick={() => setF(k)} className="rounded-full px-3.5 py-2 text-xs font-semibold"
            style={{
              background: f === k ? C.accent : C.surface, color: f === k ? "#fff" : C.dim,
              border: `1px solid ${f === k ? C.accent : C.line}`,
            }}>{l}</button>
        ))}
      </div>
      <Card pad={false}>
        {list.map((t, i) => (
          <div key={t.id} className="flex items-center gap-3 px-4 py-3.5" style={{ borderTop: i ? `1px solid ${C.lineSoft}` : "none" }}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: C.raised }}>
              {t.kind === "deposit" ? <ArrowDownLeft size={15} color={C.money} />
                : t.kind === "withdrawal" ? <ArrowUpRight size={15} color={C.dim} />
                : t.kind === "win" ? <Trophy size={15} color={C.money} />
                : <Receipt size={15} color={C.muted} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{t.label}</div>
              <div className="text-xs" style={{ color: C.muted }}>{t.at}</div>
            </div>
            <span className="whitespace-nowrap text-sm"
              style={{ fontFamily: MONO, fontWeight: 600, color: t.amount > 0 ? C.money : C.dim }}>
              {t.amount > 0 ? "+" : "−"}{naira(Math.abs(t.amount))}
            </span>
          </div>
        ))}
      </Card>
    </Page>
  );
}

function BanksScreen({ back, notify }) {
  const [adding, setAdding] = useState(false);
  return (
    <Page title="Bank accounts" sub="Payouts only go to accounts in your own name." back={back}>
      <Card pad={false}>
        {BANKS.map((b, i) => (
          <div key={b.id} className="flex items-center gap-3 px-4 py-3.5" style={{ borderTop: i ? `1px solid ${C.lineSoft}` : "none" }}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: C.raised }}>
              <Building2 size={15} color={C.accent} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{b.name}</div>
              <div className="text-xs" style={{ color: C.muted, fontFamily: MONO }}>{b.acct} · {b.holder}</div>
            </div>
            {b.primary && <span className="rounded-md px-2 py-1 text-[10px] font-bold"
              style={{ background: C.accentWash, color: C.accentInk }}>PRIMARY</span>}
          </div>
        ))}
      </Card>

      {adding ? (
        <Card className="mt-3">
          <div className="space-y-3">
            <Field label="Bank"><select style={inputStyle}>
              <option>Kuda Bank</option><option>GTBank</option><option>Access Bank</option>
              <option>OPay</option><option>PalmPay</option><option>Zenith Bank</option>
            </select></Field>
            <Field label="Account number" hint="We verify the name against your account before saving.">
              <input maxLength={10} placeholder="0123456789" style={{ ...inputStyle, fontFamily: MONO }} />
            </Field>
            <Btn onClick={() => { setAdding(false); notify("Account added and verified"); }}>Verify and save</Btn>
            <Btn variant="ghost" onClick={() => setAdding(false)}>Cancel</Btn>
          </div>
        </Card>
      ) : <div className="mt-3"><Btn variant="ghost" icon={Plus} onClick={() => setAdding(true)}>Add a bank account</Btn></div>}
    </Page>
  );
}

/* ================================================================== */

function AccountScreen({ back, go, unread, notify }) {
  return (
    <Page title="Account" back={back}>
      <Card>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: C.accentWash }}>
            <User size={20} color={C.accent} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold">Harmony</div>
            <div className="text-xs" style={{ color: C.muted, fontFamily: MONO }}>+234 •••• 4471</div>
          </div>
          <span className="rounded-md px-2 py-1 text-[10px] font-bold" style={{ background: C.moneyWash, color: C.money }}>TIER 1</span>
        </div>
      </Card>

      <Card className="mt-4" pad={false}>
        <ListRow icon={User} label="Profile" onClick={() => go("profile")} />
        <ListRow icon={BadgeCheck} label="Verify account" value="Tier 1" onClick={() => go("kyc")} />
        <ListRow icon={Wallet} label="Wallet" onClick={() => go("wallet")} />
        <ListRow icon={Building2} label="Bank accounts" onClick={() => go("banks")} />
        <ListRow icon={Receipt} label="Transactions" onClick={() => go("transactions")} last />
      </Card>

      <Card className="mt-4" pad={false}>
        <ListRow icon={Bell} label="Notifications" value={unread ? `${unread} new` : undefined} onClick={() => go("notifications")} />
        <ListRow icon={Gift} label="Promotions" onClick={() => go("promotions")} />
        <ListRow icon={SlidersHorizontal} label="Limits and self-exclusion" onClick={() => go("limits")} />
        <ListRow icon={Settings} label="Settings" onClick={() => go("settings")} last />
      </Card>

      <Card className="mt-4" pad={false}>
        <ListRow icon={Smartphone} label="Get the app" onClick={() => go("app")} />
        <ListRow icon={LifeBuoy} label="Help and support" onClick={() => go("help")} />
        <ListRow icon={FileText} label="Terms and settlement rules" onClick={() => go("terms")} />
        <ListRow icon={LogOut} label="Log out" tone="danger" onClick={() => notify("Logged out")} last />
      </Card>

      <p className="mt-6 text-center text-[11px]" style={{ color: C.muted }}>18+ only. Play within your means.</p>
    </Page>
  );
}

function ProfileScreen({ back, notify }) {
  return (
    <Page title="Profile" back={back}>
      <Card>
        <div className="space-y-3">
          <Field label="Display name"><input defaultValue="Harmony" style={inputStyle} /></Field>
          <Field label="Phone number" hint="Contact support to change your registered number.">
            <input defaultValue="+234 803 •••• 471" disabled style={{ ...inputStyle, color: C.muted, fontFamily: MONO }} />
          </Field>
          <Field label="Email"><input defaultValue="harmony@example.com" style={inputStyle} /></Field>
          <Btn onClick={() => notify("Profile updated")}>Save changes</Btn>
        </div>
      </Card>
      <Card className="mt-4" pad={false}>
        <ListRow icon={Shield} label="Change password" onClick={() => notify("Reset link sent by SMS")} last />
      </Card>
    </Page>
  );
}

function KycScreen({ back, notify }) {
  const tiers = [
    { tier: "Tier 1", need: "Phone verified", limit: "₦50,000 a day", done: true },
    { tier: "Tier 2", need: "BVN verified", limit: "₦1,000,000 a day", done: false },
    { tier: "Tier 3", need: "BVN, ID document and address", limit: "₦10,000,000 a day", done: false },
  ];
  return (
    <Page title="Verify account" sub="Higher tiers raise your withdrawal ceiling." back={back}>
      <div className="space-y-2">
        {tiers.map((t) => (
          <Card key={t.tier}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{ background: t.done ? C.moneyWash : C.raised }}>
                {t.done ? <Check size={15} color={C.money} strokeWidth={3} /> : <Shield size={15} color={C.muted} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{t.tier}</div>
                <div className="mt-0.5 text-sm" style={{ color: C.dim }}>{t.need}</div>
                <div className="mt-0.5 text-xs" style={{ color: C.muted, fontFamily: MONO }}>{t.limit}</div>
              </div>
              {t.done && <span className="rounded-md px-2 py-1 text-[10px] font-bold"
                style={{ background: C.moneyWash, color: C.money }}>ACTIVE</span>}
            </div>
          </Card>
        ))}
      </div>
      <Card className="mt-4">
        <Field label="BVN" hint="We verify it with your bank and never store the number itself.">
          <input maxLength={11} placeholder="11 digits" style={{ ...inputStyle, fontFamily: MONO }} />
        </Field>
        <div className="mt-3"><Btn onClick={() => notify("BVN submitted — usually verified within minutes")}>Submit BVN</Btn></div>
      </Card>
    </Page>
  );
}

function LimitsScreen({ back, notify }) {
  const [dep, setDep] = useState(50000);
  const [loss, setLoss] = useState(20000);
  return (
    <Page title="Limits and self-exclusion" sub="Limits apply immediately when you tighten them. Loosening one waits 24 hours." back={back}>
      <Card>
        <Field label="Daily deposit limit">
          <input type="number" value={dep} onChange={(e) => setDep(Number(e.target.value))}
            style={{ ...inputStyle, fontFamily: MONO, fontWeight: 600 }} />
        </Field>
        <div className="mt-3">
          <Field label="Weekly loss limit">
            <input type="number" value={loss} onChange={(e) => setLoss(Number(e.target.value))}
              style={{ ...inputStyle, fontFamily: MONO, fontWeight: 600 }} />
          </Field>
        </div>
        <div className="mt-4"><Btn onClick={() => notify("Limits saved")}>Save limits</Btn></div>
      </Card>

      <Card className="mt-4">
        <p className="text-sm font-semibold">Take a break</p>
        <p className="mt-1.5 text-sm" style={{ color: C.dim }}>
          Pause your account. You will not be able to deposit or place bets, and we will stop all marketing to you.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {["24 hours", "7 days", "30 days"].map((d) => (
            <button key={d} onClick={() => notify(`Break set for ${d}`)} className="rounded-xl py-2.5 text-xs font-semibold"
              style={{ background: C.raised, color: C.dim }}>{d}</button>
          ))}
        </div>
      </Card>

      <Card className="mt-3">
        <p className="text-sm font-semibold" style={{ color: C.danger }}>Self-exclude</p>
        <p className="mt-1.5 text-sm" style={{ color: C.dim }}>
          Closes your account for six months or permanently. This cannot be reversed early — any withdrawable
          balance is paid out to your bank.
        </p>
        <div className="mt-3"><Btn variant="danger" onClick={() => notify("Support will call you to confirm")}>Request self-exclusion</Btn></div>
      </Card>
    </Page>
  );
}

function SettingsScreen({ back, notify }) {
  const [toggles, setToggles] = useState({ push: true, results: true, promos: false, oddsChange: true, lightData: false });
  const rows = [
    ["push", "Push notifications", "Kick-off reminders and bet results"],
    ["results", "Result alerts", "Tell me the moment a bet settles"],
    ["promos", "Promotional messages", "Offers and free bets"],
    ["oddsChange", "Accept higher odds automatically", "Never accept a worse price without asking"],
    ["lightData", "Data saver", "Fewer live updates, lighter pages"],
  ];
  return (
    <Page title="Settings" back={back}>
      <Card pad={false}>
        {rows.map(([k, label, hint], i) => (
          <div key={k} className="flex items-center gap-3 px-4 py-3.5" style={{ borderTop: i ? `1px solid ${C.lineSoft}` : "none" }}>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{label}</div>
              <div className="mt-0.5 text-xs" style={{ color: C.muted }}>{hint}</div>
            </div>
            <button onClick={() => { setToggles((t) => ({ ...t, [k]: !t[k] })); notify(`${label} ${toggles[k] ? "off" : "on"}`); }}
              className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
              style={{ background: toggles[k] ? C.accent : C.line }} aria-pressed={toggles[k]} aria-label={label}>
              <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all" style={{ left: toggles[k] ? 22 : 2 }} />
            </button>
          </div>
        ))}
      </Card>
    </Page>
  );
}

function HelpScreen({ back, go, notify }) {
  const faqs = [
    ["How long do withdrawals take?", "Most land within three minutes. Anything held for review is usually cleared within four hours."],
    ["Why was my bet rejected?", "Either the market suspended, or the price moved against you and your settings are set to reject worse prices."],
    ["What happens if a match is postponed?", "The market voids and your stake is returned if the fixture is not replayed within 48 hours."],
    ["How do booking codes work?", "Any slip generates a six-character code. Share it and anyone can load the same selections, edit them, and stake their own amount."],
  ];
  const [open, setOpen] = useState(null);
  return (
    <Page title="Help and support" back={back}>
      <Card pad={false}>
        {faqs.map(([q, a], i) => (
          <div key={q} style={{ borderTop: i ? `1px solid ${C.lineSoft}` : "none" }}>
            <button onClick={() => setOpen(open === i ? null : i)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
              <span className="text-sm font-medium">{q}</span>
              <ChevronDown size={16} color={C.muted} style={{ transform: open === i ? "none" : "rotate(-90deg)" }} />
            </button>
            {open === i && <p className="px-4 pb-4 text-sm" style={{ color: C.dim }}>{a}</p>}
          </div>
        ))}
      </Card>
      <Card className="mt-4" pad={false}>
        <ListRow icon={LifeBuoy} label="Chat with support" onClick={() => notify("Opening chat…")} />
        <ListRow icon={FileText} label="Settlement rules" onClick={() => go("terms")} last />
      </Card>
    </Page>
  );
}

function TermsScreen({ back }) {
  const rules = [
    ["Abandoned matches", "All markets void and stakes returned, unless the market had already resolved beyond doubt — for example Over 1.5 goals with three already scored."],
    ["Postponed fixtures", "Void if not replayed within 48 hours of the scheduled kick-off."],
    ["Venue changes", "Void if the match moves to the opposing team's ground. Neutral venues stand."],
    ["Player markets", "Void if the named player takes no part. Anytime scorer stands if the player appears at all."],
    ["Cards", "Yellow counts as one, red as two. A second yellow leading to a red adds one card only, for three in total."],
    ["Corners", "Corners awarded, not corners taken. A corner awarded but not taken still counts."],
    ["Palpable errors", "A market published at an obviously wrong price is void."],
  ];
  return (
    <Page title="Settlement rules" sub="These are the rules we settle to, word for word." back={back}>
      <Card pad={false}>
        {rules.map(([t, b], i) => (
          <div key={t} className="px-4 py-3.5" style={{ borderTop: i ? `1px solid ${C.lineSoft}` : "none" }}>
            <div className="text-sm font-semibold">{t}</div>
            <p className="mt-1 text-sm" style={{ color: C.dim }}>{b}</p>
          </div>
        ))}
      </Card>
    </Page>
  );
}

/* ================================================================== */

function PromotionsScreen({ back, go }) {
  return (
    <Page title="Promotions" back={back}>
      <div className="grid gap-3 sm:grid-cols-2">
        {PROMOS.map((p) => (
          <button key={p.id} onClick={() => go("promoDetail", { promo: p })} className="text-left">
            <Card>
              <span className="rounded-md px-2 py-1 text-[10px] font-bold" style={{ background: C.accentWash, color: C.accentInk }}>
                {p.kind.toUpperCase()}
              </span>
              <h3 className="mt-2.5 text-base" style={{ fontFamily: DISPLAY, fontWeight: 700 }}>{p.title}</h3>
              <p className="mt-1.5 text-sm" style={{ color: C.dim }}>{p.body}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold" style={{ color: C.accentInk }}>
                {p.cta} <ChevronRight size={14} />
              </span>
            </Card>
          </button>
        ))}
      </div>
    </Page>
  );
}

function PromoDetailScreen({ promo, back, notify, go }) {
  return (
    <Page title={promo.title} sub={promo.kind} back={back}>
      <Card><p className="text-sm" style={{ color: C.dim }}>{promo.body}</p></Card>
      <Card className="mt-3">
        <p className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: C.muted }}>Key terms</p>
        <ul className="mt-2 space-y-1.5 text-sm" style={{ color: C.dim }}>
          <li>Legs priced under 1.20 do not count toward the leg total.</li>
          <li>Void legs are removed before counting.</li>
          <li>Bonuses apply to winnings, not to your stake.</li>
          <li>One claim per account, device and bank account.</li>
        </ul>
      </Card>
      <div className="mt-4 space-y-2">
        <Btn onClick={() => { notify("Bonus applied to your account"); go("wallet"); }}>{promo.cta}</Btn>
        <Btn variant="ghost" onClick={back}>Back to promotions</Btn>
      </div>
    </Page>
  );
}

function VirtualsScreen({ back, pick, isOn }) {
  const [secs, setSecs] = useState(97);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => (s > 0 ? s - 1 : 150)), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <Page title="Virtual football" sub="A new round every three minutes. Published RTP 94%." back={back}>
      <Card className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.muted }}>Betting closes in</div>
          <div className="text-2xl" style={{ fontFamily: MONO, fontWeight: 600, color: C.accentInk }}>
            {String(Math.floor(secs / 60)).padStart(2, "0")}:{String(secs % 60).padStart(2, "0")}
          </div>
        </div>
        <span className="rounded-md px-2 py-1 text-[10px] font-bold" style={{ background: C.moneyWash, color: C.money }}>
          PROVABLY FAIR
        </span>
      </Card>

      <div className="mt-4 overflow-hidden rounded-2xl" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
        {VIRTUAL_ROUND.map((g, i) => {
          const main = { id: `${g.id}:main:1X2`, name: "1X2" };
          return (
            <div key={g.id} className="flex items-center gap-3 px-3 py-3" style={{ borderTop: i ? `1px solid ${C.lineSoft}` : "none" }}>
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="truncate text-[14px] font-medium leading-snug">{g.home}</div>
                <div className="truncate text-[14px] font-medium leading-snug">{g.away}</div>
              </div>
              <div className="flex shrink-0 gap-1.5" style={{ width: "min(46vw, 232px)" }}>
                {["1", "X", "2"].map((kk) => {
                  const on = isOn(main.id, kk);
                  return (
                    <button key={kk} onClick={() => pick(g, main, { label: kk, odd: g.odds[kk] })}
                      className="flex-1 rounded-lg py-2.5 text-[13px]"
                      style={{ background: on ? C.accent : C.raised, color: on ? "#fff" : C.text, fontFamily: MONO, fontWeight: 600 }}>
                      {g.odds[kk].toFixed(2)}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-xs" style={{ color: C.muted }}>
        Each round's seed hash is published before betting opens and the seed revealed after settlement,
        so any result can be recomputed independently.
      </p>
    </Page>
  );
}

function JackpotScreen({ back, notify }) {
  const [picks, setPicks] = useState({});
  const complete = Object.keys(picks).length === JACKPOT_FIXTURES.length;
  return (
    <Page title="Jackpot" sub="Pick all seven results. ₦100 entry, ₦25,000,000 pool." back={back}>
      <Card className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.muted }}>Prize pool</div>
          <div className="text-xl" style={{ fontFamily: MONO, fontWeight: 600, color: C.money }}>₦25,000,000</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.muted }}>Selected</div>
          <div className="text-xl" style={{ fontFamily: MONO, fontWeight: 600 }}>
            {Object.keys(picks).length}/{JACKPOT_FIXTURES.length}
          </div>
        </div>
      </Card>

      <div className="mt-4 overflow-hidden rounded-2xl" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
        {JACKPOT_FIXTURES.map((g, i) => (
          <div key={g.id} className="flex items-center gap-3 px-3 py-3" style={{ borderTop: i ? `1px solid ${C.lineSoft}` : "none" }}>
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="truncate text-[14px] font-medium leading-snug">{g.home}</div>
              <div className="truncate text-[14px] font-medium leading-snug">{g.away}</div>
            </div>
            <div className="flex shrink-0 gap-1.5" style={{ width: "min(40vw, 180px)" }}>
              {["1", "X", "2"].map((kk) => {
                const on = picks[g.id] === kk;
                return (
                  <button key={kk} onClick={() => setPicks((p) => ({ ...p, [g.id]: kk }))}
                    className="flex-1 rounded-lg py-2.5 text-[13px]"
                    style={{ background: on ? C.accent : C.raised, color: on ? "#fff" : C.text, fontFamily: MONO, fontWeight: 600 }}>
                    {kk}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        <Btn disabled={!complete} onClick={() => notify("Jackpot entry placed for ₦100")}>
          {complete ? "Enter for ₦100" : `Pick ${JACKPOT_FIXTURES.length - Object.keys(picks).length} more`}
        </Btn>
        <Btn variant="ghost" onClick={() => {
          const auto = {};
          JACKPOT_FIXTURES.forEach((g) => { auto[g.id] = ["1", "X", "2"][Math.floor(Math.random() * 3)]; });
          setPicks(auto);
        }}>Pick for me</Btn>
      </div>

      <p className="mt-3 text-xs" style={{ color: C.muted }}>
        Consolation tiers pay at six and five correct. A postponed fixture counts as correct for everyone.
      </p>
    </Page>
  );
}

function GetAppScreen({ back, notify }) {
  return (
    <Page title="Get the app" sub="Android and iOS. Live scores, one-tap rebet, faster than the browser." back={back}>
      <div className="space-y-2">
        {[["Google Play", "Android 8 and above"], ["App Store", "iOS 15 and above"], ["Direct APK", "For devices without Play Services"]].map(([n, s]) => (
          <button key={n} onClick={() => notify(`Opening ${n}…`)} className="block w-full text-left">
            <Card>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: C.accentWash }}>
                  <Smartphone size={18} color={C.accent} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{n}</div>
                  <div className="text-xs" style={{ color: C.muted }}>{s}</div>
                </div>
                <ChevronRight size={16} color={C.muted} />
              </div>
            </Card>
          </button>
        ))}
      </div>
      <Card className="mt-4">
        <p className="text-sm" style={{ color: C.dim }}>
          The app is under 15MB and caches fixtures, so it opens instantly and works on a weak connection.
          Odds still need data to stay live.
        </p>
      </Card>
    </Page>
  );
}

/* ================================================================== */

function SlipBody({
  slip, setSlip, totalOdds, payout, stake, setStake, balance, code, placed,
  builderMatches, clearSlip, placeBet, collapse, go, notify,
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <>
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3.5"
        style={{ background: C.surface, borderBottom: `1px solid ${C.line}` }}>
        <h3 className="text-base" style={{ fontFamily: DISPLAY, fontWeight: 700 }}>Bet slip</h3>
        <div className="flex items-center gap-3">
          {slip.length > 0 && <button onClick={clearSlip} aria-label="Clear slip"><Trash2 size={16} color={C.muted} /></button>}
          <button onClick={collapse} aria-label="Minimise bet slip"
            className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: C.raised }}>
            <Minus size={15} color={C.dim} />
          </button>
        </div>
      </div>

      {placed ? (
        <div className="px-5 py-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full" style={{ background: C.money }}>
            <Check size={26} strokeWidth={3} color="#fff" />
          </div>
          <p className="text-lg" style={{ fontFamily: DISPLAY, fontWeight: 700 }}>Bet placed</p>
          <p className="mt-1.5 text-sm" style={{ color: C.dim }}>
            {naira(stake)} on {slip.length} selection{slip.length > 1 ? "s" : ""} to return {naira(Math.round(payout))}.
          </p>
          <div className="mx-auto mt-5 inline-block rounded-xl px-4 py-2.5"
            style={{ background: C.raised, fontFamily: MONO, letterSpacing: ".18em", fontWeight: 600 }}>{code}</div>
          <div className="mt-5 space-y-2">
            <Btn variant="soft" onClick={() => { clearSlip(); go("bets"); }}>View in My bets</Btn>
            <Btn variant="ghost" onClick={clearSlip}>Back to matches</Btn>
          </div>
        </div>
      ) : (
        <>
          {builderMatches > 0 && (
            <div className="mx-4 mt-3 flex items-start gap-2.5 rounded-xl px-3.5 py-3" style={{ background: C.accentWash }}>
              <Layers size={14} color={C.accent} className="mt-0.5 shrink-0" />
              <span className="text-xs leading-relaxed" style={{ color: C.dim }}>
                Bet builder — legs from the same match are priced together, so the combined odds are lower
                than the straight multiple.
              </span>
            </div>
          )}

          <div className="space-y-2 px-4 py-3">
            {slip.map((s) => (
              <div key={s.id} className="flex items-start gap-3 rounded-xl p-3.5" style={{ background: C.raised }}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.label}</div>
                  <div className="mt-0.5 truncate text-xs" style={{ color: C.dim }}>{s.market}</div>
                  <div className="mt-0.5 truncate text-[11px]" style={{ color: C.muted }}>{s.match}</div>
                </div>
                <span style={{ fontFamily: MONO, fontWeight: 600 }}>{s.odd.toFixed(2)}</span>
                <button onClick={() => setSlip((p) => p.filter((x) => x.id !== s.id))} aria-label="Remove">
                  <X size={15} color={C.muted} />
                </button>
              </div>
            ))}
          </div>

          <div className="relative my-1 px-4">
            <div style={{ borderTop: `1px dashed ${C.line}` }} />
            <div className="absolute -left-2.5 -top-2.5 h-5 w-5 rounded-full" style={{ background: C.bg }} />
            <div className="absolute -right-2.5 -top-2.5 h-5 w-5 rounded-full" style={{ background: C.bg }} />
          </div>

          <div className="px-4 pb-5 pt-3">
            <div className="mb-2 flex gap-2">
              {[100, 500, 1000, 5000].map((v) => (
                <button key={v} onClick={() => setStake(v)} className="flex-1 rounded-xl py-2 text-xs"
                  style={{
                    background: stake === v ? C.accentWash : C.raised,
                    color: stake === v ? C.accentInk : C.muted, fontFamily: MONO, fontWeight: 600,
                  }}>{v >= 1000 ? `${v / 1000}k` : v}</button>
              ))}
            </div>

            <div className="flex items-center rounded-xl px-3.5 py-3" style={{ background: C.raised }}>
              <span style={{ color: C.muted, fontFamily: MONO }}>₦</span>
              <input type="number" value={stake} min={100} onChange={(e) => setStake(Math.max(0, Number(e.target.value)))}
                className="w-full bg-transparent px-2 text-lg outline-none" style={{ fontFamily: MONO, fontWeight: 600 }} aria-label="Stake" />
              <span className="text-xs" style={{ color: C.muted }}>Stake</span>
            </div>

            <div className="mt-3.5 space-y-2 text-sm">
              <Row label="Selections" value={String(slip.length)} />
              <Row label="Total odds" value={totalOdds.toFixed(2)} />
              <Row label="Potential winnings" value={naira(Math.round(payout))} money />
            </div>

            {stake > balance && (
              <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl px-3 py-2.5" style={{ background: C.warnWash }}>
                <span className="text-xs" style={{ color: C.dim }}>Short by {naira(stake - balance)}</span>
                <button onClick={() => go("deposit")} className="shrink-0 text-xs font-semibold" style={{ color: C.warn }}>Deposit</button>
              </div>
            )}
            {stake < 100 && <p className="mt-2.5 text-xs" style={{ color: C.warn }}>Minimum stake is ₦100.</p>}

            <div className="mt-3.5 flex items-center justify-between rounded-xl px-3.5 py-3"
              style={{ background: C.raised, border: `1px dashed ${C.line}` }}>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: C.muted }}>Booking code</div>
                <div style={{ fontFamily: MONO, fontWeight: 600, letterSpacing: ".18em" }}>{code}</div>
              </div>
              <button onClick={() => { setCopied(true); notify(`Code ${code} copied`); }}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
                style={{ background: C.surface, color: C.accentInk, border: `1px solid ${C.line}` }}>
                {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copied" : "Share"}
              </button>
            </div>

            <div className="mt-3.5">
              <Btn disabled={stake > balance || stake < 100} onClick={placeBet}>Place bet · {naira(stake)}</Btn>
            </div>
            <p className="mt-2.5 text-center text-[11px]" style={{ color: C.muted }}>18+ only. Play within your means.</p>
          </div>
        </>
      )}
    </>
  );
}

function Row({ label, value, money }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: C.muted }}>{label}</span>
      <span style={{
        fontFamily: MONO, fontWeight: money ? 600 : 500,
        color: money ? C.money : C.text, fontSize: money ? 17 : 14,
      }}>{value}</span>
    </div>
  );
}

function BottomNav({ current, reset, go }) {
  const items = [
    { icon: Home, label: "Home", key: "home", act: () => reset("home") },
    { icon: Flame, label: "Live", key: "featured", act: () => go("featured") },
    { icon: Clock, label: "My bets", key: "bets", act: () => go("bets") },
    { icon: Wallet, label: "Wallet", key: "wallet", act: () => go("wallet") },
    { icon: User, label: "Account", key: "account", act: () => go("account") },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around py-2.5 lg:hidden"
      style={{ background: C.surface, borderTop: `1px solid ${C.line}` }}>
      {items.map(({ icon: Icon, label, key, act }) => {
        const on = key === current;
        return (
          <button key={label} onClick={act} className="flex flex-col items-center gap-1 px-3">
            <Icon size={19} color={on ? C.accent : C.muted} />
            <span className="text-[10px]" style={{ color: on ? C.accent : C.muted, fontWeight: on ? 600 : 500 }}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
