# Footly

A full-stack sports betting platform built for the Nigerian market, modelled on the SportyBet experience with original branding and UI.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Database | PostgreSQL (Neon or Supabase) |
| Cache / queues | Redis (Upstash or self-hosted) |
| Payments | Paystack (primary) · Flutterwave (fallback) |
| Odds feed | BetsAPI / The Odds API → Sportradar (when licensed) |
| Mobile | React Native (shell in `mobile/`) |
| Infra | Docker Compose (local/staging) · Caddy (TLS) |
| Observability | Prometheus + Grafana |

---

## Repository layout

```
footly/
├── app/                        # Next.js App Router pages and API routes
├── components/
│   └── footly-v6.jsx           # Full UI — 25 screens, all navigation wired
├── admin-console.jsx           # Operator dashboard
├── mobile/
│   ├── App.tsx                 # React Native shell
│   ├── api.ts                  # API client (timeout, retry, idempotency)
│   └── realtime.tsx            # WebSocket provider + useOdds hook
├── odds-feed/
│   ├── types.ts                # Domain types (provider-agnostic)
│   ├── provider.ts             # Provider adapter + Sportradar mapping
│   ├── stream.ts               # Ingestion pipeline (sequence guard, margin, suspension)
│   ├── placement.ts            # Bet placement (price check, correlation, idempotency)
│   └── settlement.ts           # Settlement worker (idempotent, void rules, rollback)
├── wallet/
│   ├── ledger.ts               # Double-entry ledger service
│   ├── psp.ts                  # Paystack + Flutterwave adapters + router
│   ├── deposits.ts             # Deposit service (initiation, webhook, reconciliation)
│   ├── withdrawals.ts          # Withdrawal service (KYC tiers, auto-approve, payout queue)
│   └── bonus.ts                # Bonus engine (acca tiers, wagering, insurance, expiry)
├── pricing/
│   ├── builder.ts              # Bet builder pricer (bivariate Poisson)
│   └── cashout.ts              # Cash-out engine (fair value, re-verification)
├── games/
│   └── virtuals.ts             # Provably fair virtual football + jackpot settlement
├── markets.ts                  # ~110 football markets + basketball/tennis boards
├── schema.sql                  # Full Postgres schema
├── docker-compose.yml          # Local/staging stack
├── RUNBOOK.md                  # Go-live checklist, alert thresholds, incident procedures
├── .env.example                # All required environment variables
└── README.md
```

---

## Getting started

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- A Neon or Supabase Postgres database
- Paystack account (test keys are fine to start)

### 1. Clone and install

```bash
git clone https://github.com/your-org/footly.git
cd footly
npm install
```

### 2. Environment variables

```bash
cp .env.example .env.local
# Fill in every value — see comments inside .env.example
```

### 3. Database

```bash
psql $DATABASE_URL < schema.sql
```

Create the `odds_history` monthly partitions before going live — a missing partition causes a hard insert error:

```sql
CREATE TABLE odds_history_2025_08 PARTITION OF odds_history
  FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');
```

### 4. Run locally

```bash
# Full stack (postgres, redis, api, feed, workers, caddy, prometheus, grafana)
docker compose up

# Or Next.js dev server only (needs external DB and Redis)
npm run dev
```

---

## Architecture notes

### Ledger
Double-entry. Balances are derived from `ledger_entries`, never stored as mutable columns. `account_balances` is a materialised view — replace with a snapshot table at production load. Run the nightly reconciliation job to alert on drift.

### Odds feed
The feed pipeline is a **singleton**. Two instances race on sequence numbers and will corrupt price state. Enforce this in Docker Compose (scale = 1) and in your deployment manifest.

### Bet builder
Uses bivariate Poisson fitted to published 1X2 and over/under prices. Non-goal markets (corners, cards, scorers) use a marginal × correlation nudge — declared as an approximation. A payout cap applies until the model is calibrated against settled volume.

### Cash-out
Re-quotes at acceptance. The offer expires in 12 seconds and is invalidated on any market suspension.

### Payments
**Never credit from a webhook body.** Always call `verifyCharge()` and credit what the API returns. See `wallet/deposits.ts`.

### Real-money gate
Real money flows are gated behind `REAL_MONEY_ENABLED=false` in `.env`. Leave this off until your NLRC federal licence or Lagos LSLGA approval is in hand.

---

## KYC tiers

| Tier | Requirement | Daily withdrawal ceiling | Auto-approve |
|---|---|---|---|
| 1 | Phone verified | ₦50,000 | ₦20,000 |
| 2 | BVN verified | ₦1,000,000 | ₦200,000 |
| 3 | BVN + ID + address | ₦10,000,000 | manual |

---

## Licensing

This repository is proprietary. All rights reserved — Harmonics Hub and Technologies Limited (RC No. 9555391).

---

## Responsible gambling

This platform is for adults 18 and over. Deposit limits, loss limits, break tools and self-exclusion are built into the product. Self-exclusion is permanent and cannot be reversed early.
