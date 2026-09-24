import React, { useState, useMemo } from "react";
import {
  Search, AlertTriangle, Check, X, Clock, TrendingUp, Users, Wallet,
  Shield, FileText, ChevronRight, Ban, ArrowUpRight, Flag, Zap, Activity
} from "lucide-react";

/* ================================================================== */
/*  Admin console — operator-facing. Denser than the punter app on     */
/*  purpose: this is a screen someone stares at for eight hours.       */
/* ================================================================== */

const C = {
  base: "#07100F", surface: "#0E1B19", raised: "#152826", line: "#1E3532",
  teal: "#12E0B8", tealDeep: "#0A8C74", amber: "#FFB020", red: "#FF5A5A",
  text: "#E6F2EF", muted: "#6E8A85",
};
const DISPLAY = "'Barlow Condensed','Arial Narrow',sans-serif";
const BODY = "'Inter',system-ui,sans-serif";
const MONO = "'IBM Plex Mono',ui-monospace,monospace";

const ngn = (kobo) => "₦" + (kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 0 });

/* ------------------------------- data ----------------------------- */

const WITHDRAWALS = [
  { id: "wd_8812", user: "Chidi O.", tier: "tier_2", amount: 24500000, bank: "Kuda Bank", acct: "•••4471",
    flags: ["above auto-approve ceiling"], turnover: 0.94, age: "6m", risk: "low" },
  { id: "wd_8809", user: "Blessing A.", tier: "tier_1", amount: 4800000, bank: "OPay", acct: "•••2210",
    flags: ["new bank account within 24h"], turnover: 1.42, age: "18m", risk: "medium" },
  { id: "wd_8804", user: "Musa I.", tier: "tier_3", amount: 182000000, bank: "GTBank", acct: "•••9903",
    flags: ["above auto-approve ceiling", "low turnover ratio"], turnover: 0.11, age: "41m", risk: "high" },
  { id: "wd_8801", user: "Tunde F.", tier: "tier_2", amount: 31000000, bank: "PalmPay", acct: "•••7734",
    flags: ["outside instant window"], turnover: 2.30, age: "1h 12m", risk: "low" },
  { id: "wd_8796", user: "Ngozi E.", tier: "tier_1", amount: 5000000, bank: "Access Bank", acct: "•••1182",
    flags: ["risk flags present"], turnover: 0.38, age: "2h 04m", risk: "high" },
];

const RISK_USERS = [
  { user: "Musa I.", clv: 3.8, staked: 1240000000, margin: -8.2, bets: 412, factor: 0.25, flags: ["sharp", "clv_positive"] },
  { user: "Ade K.", clv: 2.1, staked: 486000000, margin: -3.1, bets: 208, factor: 0.5, flags: ["clv_positive"] },
  { user: "Emeka N.", clv: 1.4, staked: 302000000, margin: -1.8, bets: 156, factor: 0.75, flags: ["watch"] },
  { user: "Halima B.", clv: -0.2, staked: 890000000, margin: 6.4, bets: 733, factor: 1.0, flags: [] },
];

const SETTLEMENT = [
  { market: "Corners over 9.5", event: "Arsenal v Chelsea", status: "disputed", legs: 84, exposure: 12400000, evidence: "corners: 9 (feed) / 10 (broadcast)" },
  { market: "Anytime scorer", event: "Real Madrid v Sevilla", status: "pending", legs: 231, exposure: 48200000, evidence: "awaiting official lineup confirmation" },
  { market: "Total cards over 4.5", event: "Enyimba v Rivers Utd", status: "settled", legs: 42, exposure: 0, evidence: "yellow: 5, red: 0 → 5 cards" },
];

const MARKETS_AT_RISK = [
  { market: "1X2 · Man Utd v Liverpool", liability: 412000000, cap: 500000000, status: "open" },
  { market: "Over 2.5 · Barcelona v Betis", liability: 488000000, cap: 500000000, status: "open" },
  { market: "Correct score 2-1 · Arsenal v Chelsea", liability: 503000000, cap: 500000000, status: "suspended" },
];

const NAV = [
  { key: "overview", label: "Overview", icon: Activity },
  { key: "withdrawals", label: "Withdrawals", icon: Wallet, badge: WITHDRAWALS.length },
  { key: "risk", label: "Risk", icon: Shield },
  { key: "settlement", label: "Settlement", icon: FileText, badge: 2 },
  { key: "users", label: "Users", icon: Users },
];

/* ================================================================== */

export default function AdminConsole() {
  const [tab, setTab] = useState("withdrawals");
  const [queue, setQueue] = useState(WITHDRAWALS);
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState(null);

  const decide = (id, action) => {
    setQueue((q) => q.filter((w) => w.id !== id));
    setSelected(null);
    setToast(action === "approve" ? `${id} approved — payout queued` : `${id} rejected — funds returned to balance`);
    setTimeout(() => setToast(null), 2600);
  };

  return (
    <div className="min-h-screen w-full" style={{ background: C.base, color: C.text, fontFamily: BODY }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap');
        .no-bar::-webkit-scrollbar{display:none}.no-bar{scrollbar-width:none}
        @keyframes pop{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        .pop{animation:pop .2s ease}
      `}</style>

      {/* ---------------- top bar ---------------- */}
      <header className="sticky top-0 z-40 flex items-center justify-between px-5 py-3"
        style={{ background: C.base, borderBottom: `1px solid ${C.line}` }}>
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: C.teal }}>
            <Zap size={15} strokeWidth={2.8} color={C.base} />
          </div>
          <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 21, letterSpacing: "-.01em" }}>
            FOOT<span style={{ color: C.teal }}>LY</span>
          </span>
          <span className="rounded px-2 py-0.5 text-[10px] uppercase tracking-widest"
            style={{ background: C.raised, color: C.muted, fontFamily: MONO }}>Ops</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-2 rounded-lg px-3 py-1.5 sm:flex" style={{ background: C.surface }}>
            <Search size={14} color={C.muted} />
            <input placeholder="User, bet ID, reference" className="w-52 bg-transparent text-sm outline-none" />
          </div>
          <div className="h-7 w-7 rounded-full" style={{ background: C.tealDeep }} />
        </div>
      </header>

      <div className="flex">
        {/* ---------------- sidebar ---------------- */}
        <nav className="hidden w-52 shrink-0 flex-col gap-1 p-3 md:flex"
          style={{ borderRight: `1px solid ${C.line}`, minHeight: "calc(100vh - 53px)" }}>
          {NAV.map(({ key, label, icon: Icon, badge }) => (
            <button key={key} onClick={() => { setTab(key); setSelected(null); }}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm"
              style={{
                background: tab === key ? C.raised : "transparent",
                color: tab === key ? C.text : C.muted,
                fontWeight: tab === key ? 600 : 500,
              }}>
              <Icon size={16} color={tab === key ? C.teal : C.muted} />
              <span className="flex-1 text-left">{label}</span>
              {badge ? (
                <span className="rounded-full px-1.5 text-[10px]"
                  style={{ background: C.amber, color: C.base, fontFamily: MONO, fontWeight: 600 }}>{badge}</span>
              ) : null}
            </button>
          ))}
        </nav>

        {/* mobile tabs */}
        <div className="no-bar fixed inset-x-0 bottom-0 z-40 flex gap-1 overflow-x-auto px-3 py-2 md:hidden"
          style={{ background: C.surface, borderTop: `1px solid ${C.line}` }}>
          {NAV.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => { setTab(key); setSelected(null); }}
              className="flex shrink-0 flex-col items-center gap-1 px-3">
              <Icon size={17} color={tab === key ? C.teal : C.muted} />
              <span className="text-[10px]" style={{ color: tab === key ? C.teal : C.muted }}>{label}</span>
            </button>
          ))}
        </div>

        {/* ---------------- content ---------------- */}
        <main className="min-w-0 flex-1 p-4 pb-24 md:p-6 md:pb-6">
          {tab === "overview" && <Overview />}
          {tab === "withdrawals" && (
            <Withdrawals queue={queue} selected={selected} setSelected={setSelected} decide={decide} />
          )}
          {tab === "risk" && <Risk />}
          {tab === "settlement" && <Settlement />}
          {tab === "users" && <UsersTab />}
        </main>
      </div>

      {toast && (
        <div className="pop fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl px-4 py-3 text-sm font-medium"
          style={{ background: C.teal, color: C.base, boxShadow: "0 10px 40px rgba(0,0,0,.6)" }}>
          {toast}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* Overview                                                            */
/* ================================================================== */

function Overview() {
  const cards = [
    { label: "Handle today", value: "₦48.2m", delta: "+12.4%", good: true },
    { label: "Gross margin", value: "7.8%", delta: "-0.6pt", good: false },
    { label: "Open liability", value: "₦12.4m", delta: "62% of cap", good: true },
    { label: "Median payout", value: "2m 41s", delta: "-18s", good: true },
  ];
  return (
    <>
      <H title="Overview" sub="Live position across the book. Refreshes every 30 seconds." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl p-4" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
            <div className="text-[11px] uppercase tracking-wider" style={{ color: C.muted }}>{c.label}</div>
            <div className="mt-2 text-2xl" style={{ fontFamily: MONO, fontWeight: 600 }}>{c.value}</div>
            <div className="mt-1 text-xs" style={{ color: c.good ? C.teal : C.amber }}>{c.delta}</div>
          </div>
        ))}
      </div>

      <SectionTitle>Markets near the liability cap</SectionTitle>
      <div className="space-y-2">
        {MARKETS_AT_RISK.map((m) => {
          const pct = Math.min(100, (m.liability / m.cap) * 100);
          return (
            <div key={m.market} className="rounded-xl p-4" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-medium">{m.market}</span>
                <Pill tone={m.status === "suspended" ? "red" : "muted"}>{m.status}</Pill>
              </div>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full" style={{ background: C.raised }}>
                <div className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: pct >= 100 ? C.red : pct > 85 ? C.amber : C.teal }} />
              </div>
              <div className="mt-2 flex justify-between text-xs" style={{ color: C.muted, fontFamily: MONO }}>
                <span>{ngn(m.liability)} exposed</span>
                <span>cap {ngn(m.cap)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ================================================================== */
/* Withdrawals — the queue that actually matters                       */
/* ================================================================== */

function Withdrawals({ queue, selected, setSelected, decide }) {
  const w = queue.find((x) => x.id === selected);
  const total = queue.reduce((s, x) => s + x.amount, 0);

  return (
    <>
      <H title="Withdrawal review"
         sub={`${queue.length} held for review · ${ngn(total)} total. Everything else auto-approved and paid.`} />

      {!queue.length && (
        <div className="rounded-xl p-10 text-center" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
          <Check size={26} color={C.teal} className="mx-auto mb-3" />
          <p className="text-sm font-medium">Queue is clear</p>
          <p className="mt-1 text-sm" style={{ color: C.muted }}>
            New requests appear here only when a risk rule fires.
          </p>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
        <div className="space-y-2">
          {queue.map((x) => (
            <button key={x.id} onClick={() => setSelected(x.id)}
              className="w-full rounded-xl p-4 text-left"
              style={{
                background: C.surface,
                border: `1px solid ${selected === x.id ? C.teal : C.line}`,
              }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{x.user}</span>
                    <Pill tone={x.risk === "high" ? "red" : x.risk === "medium" ? "amber" : "muted"}>{x.risk}</Pill>
                  </div>
                  <div className="mt-1 text-xs" style={{ color: C.muted, fontFamily: MONO }}>
                    {x.id} · {x.bank} {x.acct} · waiting {x.age}
                  </div>
                </div>
                <div className="text-right">
                  <div style={{ fontFamily: MONO, fontWeight: 600 }}>{ngn(x.amount)}</div>
                  <div className="text-[11px]" style={{ color: C.muted, fontFamily: MONO }}>{x.tier}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {x.flags.map((f) => (
                  <span key={f} className="flex items-center gap-1 rounded px-2 py-1 text-[11px]"
                    style={{ background: C.raised, color: C.amber }}>
                    <AlertTriangle size={10} />{f}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>

        {/* detail panel */}
        {w && (
          <aside className="pop h-fit rounded-xl p-4 lg:sticky lg:top-20"
            style={{ background: C.surface, border: `1px solid ${C.line}` }}>
            <div className="flex items-center justify-between">
              <h3 style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 20 }}>{w.user.toUpperCase()}</h3>
              <button onClick={() => setSelected(null)} aria-label="Close"><X size={17} color={C.muted} /></button>
            </div>

            <div className="mt-4 space-y-2 text-sm">
              <KV k="Amount" v={ngn(w.amount)} strong />
              <KV k="Destination" v={`${w.bank} ${w.acct}`} />
              <KV k="KYC tier" v={w.tier} />
              <KV k="Turnover ratio" v={w.turnover.toFixed(2)} tone={w.turnover < 0.6 ? "amber" : undefined} />
              <KV k="Waiting" v={w.age} />
            </div>

            <div className="mt-4 rounded-lg p-3" style={{ background: C.raised }}>
              <div className="mb-2 text-[11px] uppercase tracking-wider" style={{ color: C.muted }}>Why it stopped</div>
              <ul className="space-y-1.5">
                {w.flags.map((f) => (
                  <li key={f} className="flex gap-2 text-xs" style={{ color: C.text }}>
                    <Flag size={12} color={C.amber} className="mt-0.5 shrink-0" />{f}
                  </li>
                ))}
              </ul>
            </div>

            {w.turnover < 0.6 && (
              <p className="mt-3 text-xs" style={{ color: C.amber }}>
                Low turnover means most of what they deposited was never staked. Confirm source of funds
                before approving — this is the pattern regulators ask about.
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button onClick={() => decide(w.id, "approve")}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold"
                style={{ background: C.teal, color: C.base }}>
                <Check size={15} strokeWidth={3} />Approve
              </button>
              <button onClick={() => decide(w.id, "reject")}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold"
                style={{ background: C.raised, color: C.red }}>
                <Ban size={15} />Reject
              </button>
            </div>
            <p className="mt-2 text-center text-[11px]" style={{ color: C.muted }}>
              Rejecting returns the held funds to their balance.
            </p>
          </aside>
        )}
      </div>
    </>
  );
}

/* ================================================================== */
/* Risk                                                                */
/* ================================================================== */

function Risk() {
  const [factors, setFactors] = useState(
    Object.fromEntries(RISK_USERS.map((u) => [u.user, u.factor]))
  );

  return (
    <>
      <H title="Risk"
         sub="Punters beating the closing line. Limit them before the exposure compounds — do not close accounts you can price against." />

      <div className="overflow-x-auto rounded-xl" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
        <table className="w-full text-sm" style={{ minWidth: 680 }}>
          <thead>
            <tr style={{ color: C.muted }}>
              {["Punter", "CLV", "Staked", "Our margin", "Bets", "Stake factor"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RISK_USERS.map((u) => (
              <tr key={u.user} style={{ borderTop: `1px solid ${C.line}` }}>
                <td className="px-4 py-3">
                  <div className="font-medium">{u.user}</div>
                  <div className="mt-1 flex gap-1">
                    {u.flags.map((f) => (
                      <span key={f} className="rounded px-1.5 py-0.5 text-[10px]"
                        style={{ background: C.raised, color: C.amber, fontFamily: MONO }}>{f}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3" style={{ fontFamily: MONO, color: u.clv > 1 ? C.amber : C.text }}>
                  {u.clv > 0 ? "+" : ""}{u.clv.toFixed(1)}%
                </td>
                <td className="px-4 py-3" style={{ fontFamily: MONO }}>{ngn(u.staked)}</td>
                <td className="px-4 py-3" style={{ fontFamily: MONO, color: u.margin < 0 ? C.red : C.teal }}>
                  {u.margin > 0 ? "+" : ""}{u.margin.toFixed(1)}%
                </td>
                <td className="px-4 py-3" style={{ fontFamily: MONO, color: C.muted }}>{u.bets}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    {[0.25, 0.5, 0.75, 1].map((f) => (
                      <button key={f} onClick={() => setFactors((s) => ({ ...s, [u.user]: f }))}
                        className="rounded px-2 py-1 text-[11px]"
                        style={{
                          background: factors[u.user] === f ? C.teal : C.raised,
                          color: factors[u.user] === f ? C.base : C.muted,
                          fontFamily: MONO, fontWeight: 600,
                        }}>
                        {f}×
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs" style={{ color: C.muted }}>
        Stake factor multiplies their maximum stake. A sharp punter at 0.25× still bets, still tells you
        where your prices are wrong, and costs a quarter as much to learn from.
      </p>
    </>
  );
}

/* ================================================================== */
/* Settlement                                                          */
/* ================================================================== */

function Settlement() {
  return (
    <>
      <H title="Settlement"
         sub="Markets awaiting resolution or under dispute. Every settled leg stores the stat it was settled on." />
      <div className="space-y-2">
        {SETTLEMENT.map((s) => (
          <div key={s.market} className="rounded-xl p-4" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">{s.market}</div>
                <div className="mt-0.5 text-xs" style={{ color: C.muted }}>{s.event}</div>
              </div>
              <Pill tone={s.status === "disputed" ? "red" : s.status === "pending" ? "amber" : "teal"}>{s.status}</Pill>
            </div>
            <div className="mt-3 rounded-lg px-3 py-2 text-xs"
              style={{ background: C.raised, color: C.muted, fontFamily: MONO }}>
              {s.evidence}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs" style={{ color: C.muted, fontFamily: MONO }}>
                {s.legs} legs · {ngn(s.exposure)} exposure
              </span>
              {s.status !== "settled" && (
                <div className="flex gap-2">
                  <button className="rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ background: C.teal, color: C.base }}>
                    Settle
                  </button>
                  <button className="rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ background: C.raised, color: C.text }}>
                    Void market
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs" style={{ color: C.muted }}>
        Voiding returns every stake on the market. Use it when the feed and the broadcast disagree and you
        cannot prove which is right — a refund costs less than a reputation for arbitrary settlement.
      </p>
    </>
  );
}

/* ================================================================== */
/* Users                                                               */
/* ================================================================== */

function UsersTab() {
  const [q, setQ] = useState("");
  const rows = useMemo(
    () => RISK_USERS.filter((u) => u.user.toLowerCase().includes(q.toLowerCase())),
    [q]
  );
  return (
    <>
      <H title="Users" sub="Account lookup, KYC status, limits and self-exclusion." />
      <div className="mb-3 flex items-center gap-2 rounded-lg px-3 py-2.5" style={{ background: C.surface, border: `1px solid ${C.line}` }}>
        <Search size={15} color={C.muted} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or user ID"
          className="flex-1 bg-transparent text-sm outline-none" />
      </div>
      <div className="space-y-2">
        {rows.map((u) => (
          <div key={u.user} className="flex items-center justify-between rounded-xl p-4"
            style={{ background: C.surface, border: `1px solid ${C.line}` }}>
            <div>
              <div className="text-sm font-medium">{u.user}</div>
              <div className="mt-0.5 text-xs" style={{ color: C.muted, fontFamily: MONO }}>
                {u.bets} bets · {ngn(u.staked)} lifetime
              </div>
            </div>
            <ChevronRight size={16} color={C.muted} />
          </div>
        ))}
        {!rows.length && (
          <p className="py-12 text-center text-sm" style={{ color: C.muted }}>
            No account matches that. Try the phone number in full, including +234.
          </p>
        )}
      </div>
    </>
  );
}

/* ================================================================== */
/* Bits                                                                */
/* ================================================================== */

function H({ title, sub }) {
  return (
    <div className="mb-5">
      <h1 style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 34, textTransform: "uppercase", letterSpacing: "-.01em", lineHeight: 1 }}>
        {title}
      </h1>
      <p className="mt-2 max-w-2xl text-sm" style={{ color: C.muted }}>{sub}</p>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <h2 className="mb-3 mt-7 text-xs uppercase tracking-widest" style={{ color: C.muted, fontFamily: MONO }}>
      {children}
    </h2>
  );
}

function Pill({ children, tone = "muted" }) {
  const map = { red: C.red, amber: C.amber, teal: C.teal, muted: C.muted };
  return (
    <span className="shrink-0 rounded px-2 py-0.5 text-[10px] uppercase tracking-wider"
      style={{ background: C.raised, color: map[tone], fontFamily: MONO, fontWeight: 600 }}>
      {children}
    </span>
  );
}

function KV({ k, v, strong, tone }) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: C.muted }}>{k}</span>
      <span style={{
        fontFamily: MONO, fontWeight: strong ? 600 : 500,
        fontSize: strong ? 17 : 14,
        color: tone === "amber" ? C.amber : strong ? C.teal : C.text,
      }}>{v}</span>
    </div>
  );
}
