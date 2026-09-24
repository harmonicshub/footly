# Footly — Operations Runbook

Everything an operator needs when something breaks at 21:40 on a Saturday.

---

## Service topology

| Service | Scale | Notes |
|---|---|---|
| `api` | horizontal | Stateless. Behind Caddy. |
| `feed` | **exactly 1** | Singleton. Two instances race on market rows and produce phantom sequence gaps. |
| `stream` | horizontal | Socket fan-out only. Reads Redis pub/sub. |
| `worker` | horizontal | Settlement, payouts, sweeps. Every job idempotent. |
| `virtuals` | **exactly 1** | Round generation must be serialised. |

The two singletons are the ones to check first when behaviour is strange.

---

## Go-live checklist

Everything below is independent of licensing, which is being handled separately. Real money stays gated behind `REAL_MONEY_ENABLED` until that lands.

**Data integrity**
- [ ] `odds_history` partitions created three months ahead — a missing partition is a hard insert error, not a warning
- [ ] Nightly ledger reconciliation job running: recompute balances from `ledger_entries`, alert on any drift from `account_balances`
- [ ] Postgres PITR enabled, restore rehearsed at least once against a real backup
- [ ] `settlement_log` retention set — it grows without bound otherwise

**Money paths**
- [ ] Paystack webhook raw-body capture verified (parse-then-rehash breaks the HMAC)
- [ ] Flutterwave `verif-hash` rotated off the default
- [ ] Deposit reconciliation sweep confirmed running every 10 minutes
- [ ] Withdrawal reconciliation sweep confirmed running every 3 minutes
- [ ] Test payout to a real NUBAN completed end to end
- [ ] PSP float funded and a low-balance alert wired

**Risk**
- [ ] Per-market liability caps set for every market group, not just 1X2
- [ ] In-play accept delay confirmed at 5s in production config
- [ ] Bet-builder payout cap active (`BUILDER_LIMITS.maxPayoutKobo`)
- [ ] Correlation blocklist tested against a known-correlated slip

**Player protection**
- [ ] Deposit, stake and loss limits enforced server-side — verified by attempting to breach one via the API directly
- [ ] Self-exclusion blocks placement, deposit *and* marketing sends
- [ ] Limit-loosening cooling-off window active; tightening immediate
- [ ] Virtuals session reminders on

**Content**
- [ ] Every market in `market_types` has a settlement rule written, and it matches the help centre text word for word
- [ ] `VOID_RULES` published in the terms
- [ ] Virtuals RTP published and the fairness verifier endpoint live

---

## Alerts that should page someone

| Alert | Threshold | First action |
|---|---|---|
| Feed sequence gaps | >5/min for one event | Check `feed` replica count is 1; force resync |
| Feed stale | no message 8s | All live markets should have auto-suspended — verify, then check provider status |
| Settlement queue depth | >500 | Scale `worker`; check for a poison job |
| Withdrawal queue age | oldest >30min | Check PSP status and float balance |
| PSP float | <₦2m | Top up immediately — payouts fail silently at zero |
| Ledger drift | any non-zero | **Stop payouts.** See below. |
| Liability breach | market >cap | Should auto-suspend — verify it did |
| Deposit success rate | <85% over 15min | Flip `PspRouter.setPrimary` to the other provider |

---

## Incidents

### Ledger drift detected

The most serious alert in the system. Nightly reconciliation found `account_balances` disagreeing with the sum of `ledger_entries`.

1. **Disable withdrawals immediately.** Paying out against a balance you cannot verify compounds the loss.
2. Do not "fix" the balance. The entries are the truth; the view is derived.
3. `REFRESH MATERIALIZED VIEW CONCURRENTLY account_balances` and re-check.
4. If drift persists, the balanced-transaction trigger has been bypassed — find the code path writing to `ledger_entries` outside `LedgerService.post`.
5. Only re-enable withdrawals once reconciliation is clean two runs in a row.

### Feed provider down

1. Confirm all live markets suspended. If any are still open, suspend manually — serving stale prices during an outage is how you get picked off.
2. Pre-match markets can stay open; they move slowly.
3. Virtuals are unaffected and keep running. This is why they are a separate service.
4. On recovery the pipeline detects sequence gaps and resyncs automatically. Watch for a resync storm across many events.

### Duplicate payout suspected

1. Check `ledger_transactions` for two rows with different `idempotency_key` and the same `reference`.
2. If found, the caller generated a fresh key on retry — a client bug, not a ledger bug.
3. Reverse with a `manual_adjustment` posting. Never delete entries.

### Punter disputes a settlement

1. Pull `bet_legs.evidence` for the leg. It holds the stat the settlement used.
2. Compare against the provider's result message in `settlement_log`.
3. If the feed and the broadcast genuinely disagree and you cannot prove which is right, **void the market**. A refund costs less than a reputation for arbitrary settlement.
4. Log the decision in `audit_log` with reasoning. These accumulate into precedent.

### Suspected courtsiding

Signals: in-play singles, always on the same few markets, consistently placed 3–6 seconds before a goal, positive CLV.

1. Set `stake_factor` to 0.25 on the account — do not close it. A limited sharp still shows you where your prices are wrong.
2. Increase in-play accept delay for that account specifically.
3. Review whether the market should have suspended earlier. Often the answer is a tighter suspension trigger, not a punter problem.

---

## Routine jobs

| Job | Cadence | Owner service |
|---|---|---|
| Deposit reconciliation | 10 min | `worker` |
| Withdrawal reconciliation | 3 min | `worker` |
| Cash-out offer purge | hourly | `worker` |
| Bonus expiry sweep | nightly 03:00 | `worker` |
| Ledger reconciliation | nightly 04:00 | `worker` |
| `odds_history` partition creation | monthly | `worker` |
| Stale deposit abandonment | daily | `worker` |
| Risk profile recalculation (CLV) | nightly | `worker` |

---

## Scaling notes

Traffic is extremely spiky — Saturday 15:00–17:00 and Champions League nights carry multiples of the weekday baseline.

- **Scale `stream` first.** Socket connections, not API requests, are the binding constraint during a big match.
- **Postgres connection pooling is mandatory** at scale. Put PgBouncer in transaction mode in front of it; 200 direct connections disappears fast with four services.
- **The price cache belongs in Redis, not Postgres.** If you find yourself querying `outcomes` on the hot path, that is the bug.
- **Do not scale `feed` or `virtuals`.** If they are the bottleneck, the fix is a faster singleton, not more of them.

---

## Things deliberately left simple

Worth knowing what has been traded away, so nobody discovers it during an incident:

- **Bet-builder correlation model is approximate** for non-goal markets. The payout cap is what protects you until it is calibrated against settled volume.
- **`account_balances` is a materialised view.** Under real load, replace it with a snapshot table written in the same transaction as the entries.
- **No scout feed.** In-play protection is the 5-second accept delay plus hard suspension on every provider `bet_stop`. That is adequate at low volume and will need revisiting.
- **Single-region deployment.** Fine for a Nigeria-only book; latency to a European feed provider is the main cost.
