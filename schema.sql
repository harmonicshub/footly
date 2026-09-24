-- =====================================================================
-- FOOTLY — POSTGRES SCHEMA
-- =====================================================================
-- Conventions
--   * Money is BIGINT in kobo. Never float, never numeric-with-decimals
--     for balances. ₦1,250.50 = 125050.
--   * Every table has created_at. Mutable tables have updated_at.
--   * IDs are UUIDv7 where ordering helps (bets, transactions) and
--     UUIDv4 elsewhere. Feed-sourced rows keep the provider ID too.
--   * The wallet is double-entry. Balances are DERIVED, never stored as
--     a mutable column you UPDATE. This is the single most important
--     decision in the file.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "citext";

-- =====================================================================
-- 1. IDENTITY
-- =====================================================================

CREATE TYPE account_status AS ENUM (
  'pending_verification', 'active', 'restricted', 'self_excluded', 'closed'
);

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone           TEXT NOT NULL UNIQUE,          -- E.164, +234...
  email           CITEXT UNIQUE,
  password_hash   TEXT NOT NULL,
  display_name    TEXT,
  date_of_birth   DATE NOT NULL,
  status          account_status NOT NULL DEFAULT 'pending_verification',
  referral_code   TEXT UNIQUE,
  referred_by     UUID REFERENCES users(id),
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 18+ enforced at the database, not just the signup form.
  CONSTRAINT adult CHECK (date_of_birth <= (CURRENT_DATE - INTERVAL '18 years'))
);

CREATE INDEX ON users (status) WHERE status = 'active';
CREATE INDEX ON users (referred_by) WHERE referred_by IS NOT NULL;

-- KYC tiers gate withdrawal ceilings. Tier 1 is phone-verified only.
CREATE TYPE kyc_tier AS ENUM ('tier_0', 'tier_1', 'tier_2', 'tier_3');
CREATE TYPE kyc_status AS ENUM ('none', 'submitted', 'in_review', 'approved', 'rejected');

CREATE TABLE kyc_profiles (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier              kyc_tier NOT NULL DEFAULT 'tier_0',
  status            kyc_status NOT NULL DEFAULT 'none',
  bvn_hash          TEXT,                 -- hash only, never the raw BVN
  nin_hash          TEXT,
  id_document_type  TEXT,
  id_document_ref   TEXT,                 -- object-store key
  verified_name     TEXT,
  reviewed_by       UUID,
  reviewed_at       TIMESTAMPTZ,
  rejection_reason  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  device_label  TEXT,
  ip            INET,
  user_agent    TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON sessions (user_id) WHERE revoked_at IS NULL;

-- =====================================================================
-- 2. RESPONSIBLE GAMBLING
-- =====================================================================
-- Enforced server-side on every placement and deposit. Not a settings
-- screen that does nothing.

CREATE TYPE limit_kind AS ENUM ('deposit', 'stake', 'loss', 'session_time');
CREATE TYPE limit_period AS ENUM ('daily', 'weekly', 'monthly');

CREATE TABLE user_limits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          limit_kind NOT NULL,
  period        limit_period NOT NULL,
  amount_kobo   BIGINT,                    -- NULL for session_time
  minutes       INT,                       -- for session_time
  effective_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, period)
);

-- Loosening a limit takes effect after a cooling-off window; tightening
-- is immediate. Store both and let the app read the stricter one.
CREATE TABLE user_limit_changes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  limit_id      UUID NOT NULL REFERENCES user_limits(id) ON DELETE CASCADE,
  old_amount    BIGINT,
  new_amount    BIGINT,
  applies_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE self_exclusions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at       TIMESTAMPTZ,               -- NULL = permanent
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON self_exclusions (user_id, ends_at);

-- =====================================================================
-- 3. WALLET — DOUBLE ENTRY
-- =====================================================================
-- Every movement of money writes two rows summing to zero. Balance is
-- SUM(amount) over a user's accounts. Slower to read, impossible to
-- silently corrupt — and reconcilable against Paystack line by line.

CREATE TYPE account_kind AS ENUM (
  'user_cash',        -- withdrawable
  'user_bonus',       -- promo funds, withdrawal-locked
  'user_locked',      -- stake held on open bets
  'house_revenue',
  'house_liability',
  'psp_settlement',   -- money in transit at the payment provider
  'promo_expense'
);

CREATE TABLE ledger_accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,  -- NULL for house
  kind        account_kind NOT NULL,
  currency    CHAR(3) NOT NULL DEFAULT 'NGN',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, currency)
);

CREATE TYPE entry_reason AS ENUM (
  'deposit', 'withdrawal', 'withdrawal_reversal',
  'stake', 'stake_refund', 'winnings', 'cashout',
  'bonus_grant', 'bonus_convert', 'bonus_expiry',
  'settlement_rollback', 'manual_adjustment', 'fee'
);

-- Transactions group entries. One transaction = one business event.
CREATE TABLE ledger_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reason            entry_reason NOT NULL,
  -- Makes retries safe: the same key can only ever create one txn.
  idempotency_key   TEXT NOT NULL UNIQUE,
  reference         TEXT,                  -- bet id, payout id, PSP ref
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON ledger_transactions (reference);
CREATE INDEX ON ledger_transactions (created_at DESC);

CREATE TABLE ledger_entries (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id  UUID NOT NULL REFERENCES ledger_transactions(id),
  account_id      UUID NOT NULL REFERENCES ledger_accounts(id),
  amount_kobo     BIGINT NOT NULL,         -- signed; credits positive
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT nonzero CHECK (amount_kobo <> 0)
);

CREATE INDEX ON ledger_entries (account_id, created_at DESC);
CREATE INDEX ON ledger_entries (transaction_id);

-- Enforce the accounting identity: entries in a transaction sum to zero.
CREATE OR REPLACE FUNCTION assert_balanced_transaction() RETURNS TRIGGER AS $$
DECLARE total BIGINT;
BEGIN
  SELECT COALESCE(SUM(amount_kobo), 0) INTO total
  FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
  IF total <> 0 THEN
    RAISE EXCEPTION 'unbalanced transaction %: sums to %', NEW.transaction_id, total;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_balanced_transaction();

-- Fast balance reads. Refresh on a short interval, or replace with a
-- rolling snapshot table if this becomes the hot path.
CREATE MATERIALIZED VIEW account_balances AS
SELECT a.id AS account_id, a.user_id, a.kind,
       COALESCE(SUM(e.amount_kobo), 0) AS balance_kobo
FROM ledger_accounts a
LEFT JOIN ledger_entries e ON e.account_id = a.id
GROUP BY a.id;

CREATE UNIQUE INDEX ON account_balances (account_id);
CREATE INDEX ON account_balances (user_id);

-- =====================================================================
-- 4. PAYMENTS
-- =====================================================================

CREATE TYPE psp AS ENUM ('paystack', 'flutterwave', 'monnify', 'opay', 'manual');
CREATE TYPE payment_status AS ENUM (
  'initiated', 'pending', 'succeeded', 'failed', 'reversed', 'abandoned'
);

CREATE TABLE deposits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  provider        psp NOT NULL,
  provider_ref    TEXT NOT NULL,
  amount_kobo     BIGINT NOT NULL CHECK (amount_kobo > 0),
  fee_kobo        BIGINT NOT NULL DEFAULT 0,
  channel         TEXT,                    -- card, bank_transfer, ussd, qr
  status          payment_status NOT NULL DEFAULT 'initiated',
  transaction_id  UUID REFERENCES ledger_transactions(id),
  raw_payload     JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  UNIQUE (provider, provider_ref)
);

CREATE INDEX ON deposits (user_id, created_at DESC);
CREATE INDEX ON deposits (status) WHERE status IN ('initiated', 'pending');

CREATE TABLE bank_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank_code       TEXT NOT NULL,
  account_number  TEXT NOT NULL,
  account_name    TEXT NOT NULL,
  verified_at     TIMESTAMPTZ,
  is_default      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, bank_code, account_number)
);

CREATE TYPE withdrawal_status AS ENUM (
  'requested', 'review', 'approved', 'processing', 'paid', 'rejected', 'failed'
);

CREATE TABLE withdrawals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id),
  bank_account_id   UUID NOT NULL REFERENCES bank_accounts(id),
  amount_kobo       BIGINT NOT NULL CHECK (amount_kobo > 0),
  fee_kobo          BIGINT NOT NULL DEFAULT 0,
  status            withdrawal_status NOT NULL DEFAULT 'requested',
  provider          psp,
  provider_ref      TEXT,
  -- Auto-approved below the tier ceiling; queued for review above it.
  auto_approved     BOOLEAN NOT NULL DEFAULT false,
  reviewed_by       UUID,
  reviewed_at       TIMESTAMPTZ,
  rejection_reason  TEXT,
  transaction_id    UUID REFERENCES ledger_transactions(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at           TIMESTAMPTZ
);

CREATE INDEX ON withdrawals (status, created_at) WHERE status IN ('requested', 'review', 'processing');
CREATE INDEX ON withdrawals (user_id, created_at DESC);

-- =====================================================================
-- 5. SPORTS DATA
-- =====================================================================

CREATE TABLE sports (
  id      TEXT PRIMARY KEY,               -- 'football', 'basketball'
  name    TEXT NOT NULL,
  sort    INT NOT NULL DEFAULT 0,
  active  BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE competitions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport_id      TEXT NOT NULL REFERENCES sports(id),
  provider      TEXT NOT NULL,
  provider_id   TEXT NOT NULL,
  name          TEXT NOT NULL,
  country       TEXT,
  tier          INT,                       -- 1 = top flight, drives sort order
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_id)
);

CREATE INDEX ON competitions (sport_id, tier) WHERE active;

CREATE TYPE event_status AS ENUM (
  'scheduled', 'live', 'halftime', 'suspended',
  'ended', 'postponed', 'abandoned', 'cancelled'
);

CREATE TABLE events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id  UUID NOT NULL REFERENCES competitions(id),
  provider        TEXT NOT NULL,
  provider_id     TEXT NOT NULL,
  home_name       TEXT NOT NULL,
  away_name       TEXT NOT NULL,
  starts_at       TIMESTAMPTZ NOT NULL,
  status          event_status NOT NULL DEFAULT 'scheduled',
  home_score      INT,
  away_score      INT,
  period          TEXT,
  minute          INT,
  -- Last applied feed sequence. The pipeline resyncs on a gap.
  feed_sequence   BIGINT NOT NULL DEFAULT 0,
  featured        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_id)
);

CREATE INDEX ON events (starts_at) WHERE status = 'scheduled';
CREATE INDEX ON events (status) WHERE status IN ('live', 'halftime');
CREATE INDEX ON events (competition_id, starts_at);

-- Canonical market catalogue — mirrors markets.ts. Seeded, not feed-driven.
CREATE TABLE market_types (
  key           TEXT PRIMARY KEY,          -- '1x2', 'ou_goals', 'corners_ah'
  sport_id      TEXT NOT NULL REFERENCES sports(id),
  name          TEXT NOT NULL,
  market_group  TEXT NOT NULL,
  shape         TEXT NOT NULL,             -- 2way, 3way, line, grid...
  period        TEXT NOT NULL DEFAULT 'FT',
  settlement    TEXT NOT NULL,             -- shown verbatim in the help centre
  live_eligible BOOLEAN NOT NULL DEFAULT true,
  cashout       BOOLEAN NOT NULL DEFAULT true,
  margin_bps    INT NOT NULL DEFAULT 900,  -- 900 = 9% overround target
  sort          INT NOT NULL DEFAULT 0
);

-- Vendor ID → our key. Swapping feed vendor touches this table only.
CREATE TABLE market_mappings (
  provider            TEXT NOT NULL,
  provider_market_id  TEXT NOT NULL,
  market_key          TEXT NOT NULL REFERENCES market_types(key),
  outcome_map         JSONB NOT NULL DEFAULT '{}',
  line_specifier      TEXT,
  PRIMARY KEY (provider, provider_market_id)
);

CREATE TYPE market_status AS ENUM ('open', 'suspended', 'closed', 'settled', 'voided');

CREATE TABLE markets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  market_key      TEXT NOT NULL REFERENCES market_types(key),
  line            NUMERIC(6,2),
  status          market_status NOT NULL DEFAULT 'open',
  suspend_reason  TEXT,
  suspended_at    TIMESTAMPTZ,
  overround       NUMERIC(6,4),
  -- Open liability in kobo. Suspend the market when it breaches the cap.
  liability_kobo  BIGINT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, market_key, line)
);

CREATE INDEX ON markets (event_id) WHERE status = 'open';
CREATE INDEX ON markets (status, updated_at);

CREATE TYPE outcome_status AS ENUM (
  'open', 'won', 'lost', 'void', 'half_won', 'half_lost'
);

CREATE TABLE outcomes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id     UUID NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,
  price         NUMERIC(8,3) NOT NULL CHECK (price > 1),
  raw_price     NUMERIC(8,3) NOT NULL,     -- pre-margin, for audit
  status        outcome_status NOT NULL DEFAULT 'open',
  -- Bumps on every price change. Placement rejects a stale version.
  version       BIGINT NOT NULL DEFAULT 1,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (market_id, label)
);

CREATE INDEX ON outcomes (market_id);

-- Append-only price history. Partition monthly and drop old partitions;
-- this is the highest-volume table in the system by an order of magnitude.
CREATE TABLE odds_history (
  outcome_id  UUID NOT NULL,
  price       NUMERIC(8,3) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (recorded_at);

CREATE TABLE odds_history_2026_08 PARTITION OF odds_history
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE INDEX ON odds_history (outcome_id, recorded_at DESC);

-- =====================================================================
-- 6. BETTING
-- =====================================================================

CREATE TYPE bet_type AS ENUM ('single', 'multiple', 'system', 'builder', 'jackpot');
CREATE TYPE bet_status AS ENUM (
  'open', 'won', 'lost', 'void', 'half_won', 'cashed_out'
);

CREATE TABLE bets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id),
  bet_type            bet_type NOT NULL,
  system_size         INT,                 -- e.g. 3 for a 3/5 system
  stake_kobo          BIGINT NOT NULL CHECK (stake_kobo > 0),
  bonus_stake_kobo    BIGINT NOT NULL DEFAULT 0,
  total_odds          NUMERIC(12,3) NOT NULL,
  potential_return    BIGINT NOT NULL,
  bonus_multiplier    NUMERIC(6,4) NOT NULL DEFAULT 1,  -- acca bonus
  status              bet_status NOT NULL DEFAULT 'open',
  payout_kobo         BIGINT NOT NULL DEFAULT 0,
  cashout_kobo        BIGINT,
  booking_code        TEXT,
  placed_from         TEXT,                -- 'app_android', 'web', 'ussd'
  idempotency_key     TEXT NOT NULL UNIQUE,
  is_live             BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at          TIMESTAMPTZ
);

CREATE INDEX ON bets (user_id, created_at DESC);
CREATE INDEX ON bets (status) WHERE status = 'open';
CREATE INDEX ON bets (created_at DESC);

CREATE TABLE bet_legs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id        UUID NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
  event_id      UUID NOT NULL REFERENCES events(id),
  market_id     UUID NOT NULL REFERENCES markets(id),
  outcome_id    UUID NOT NULL REFERENCES outcomes(id),
  -- Price is COPIED, not joined. The odds row will change; this must not.
  price         NUMERIC(8,3) NOT NULL,
  market_label  TEXT NOT NULL,             -- denormalised for bet history
  outcome_label TEXT NOT NULL,
  event_label   TEXT NOT NULL,
  status        outcome_status NOT NULL DEFAULT 'open',
  settled_at    TIMESTAMPTZ,
  evidence      JSONB,                     -- stats used at settlement
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON bet_legs (bet_id);
CREATE INDEX ON bet_legs (market_id) WHERE status = 'open';
CREATE INDEX ON bet_legs (event_id);

-- Idempotency guard for the settlement worker.
CREATE TABLE settlement_log (
  key         TEXT PRIMARY KEY,            -- eventId:marketId:sequence
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload     JSONB
);

CREATE TABLE cashout_offers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bet_id        UUID NOT NULL REFERENCES bets(id) ON DELETE CASCADE,
  amount_kobo   BIGINT NOT NULL,
  -- Offers are short-lived. An expired offer is never honoured.
  expires_at    TIMESTAMPTZ NOT NULL,
  accepted_at   TIMESTAMPTZ,
  invalidated   BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON cashout_offers (bet_id) WHERE NOT invalidated AND accepted_at IS NULL;

-- =====================================================================
-- 7. BOOKING CODES
-- =====================================================================
-- The social loop. A code is a first-class object with its own
-- analytics, not a serialised URL parameter.

CREATE TABLE booking_codes (
  code          TEXT PRIMARY KEY,          -- 6 chars, no ambiguous glyphs
  created_by    UUID REFERENCES users(id),
  selections    JSONB NOT NULL,            -- [{market_key, line, outcome_label, event_provider_id}]
  legs          INT NOT NULL,
  snapshot_odds NUMERIC(12,3) NOT NULL,    -- odds when booked, display only
  loads         INT NOT NULL DEFAULT 0,
  bets_placed   INT NOT NULL DEFAULT 0,
  stake_placed  BIGINT NOT NULL DEFAULT 0,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON booking_codes (created_by, created_at DESC);
CREATE INDEX ON booking_codes (bets_placed DESC) WHERE bets_placed > 0;

-- =====================================================================
-- 8. BONUSES AND PROMOTIONS
-- =====================================================================

CREATE TYPE bonus_kind AS ENUM (
  'welcome', 'deposit_match', 'free_bet', 'acca_boost',
  'acca_insurance', 'cashback', 'referral'
);

CREATE TABLE promotions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              TEXT UNIQUE,
  kind              bonus_kind NOT NULL,
  name              TEXT NOT NULL,
  terms             TEXT NOT NULL,
  -- Rules the engine reads: min odds, min legs, wagering multiple, caps.
  rules             JSONB NOT NULL,
  starts_at         TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ,
  max_grants        INT,
  grants_issued     INT NOT NULL DEFAULT 0,
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE bonus_status AS ENUM ('active', 'wagered', 'expired', 'forfeited');

CREATE TABLE user_bonuses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  promotion_id      UUID NOT NULL REFERENCES promotions(id),
  amount_kobo       BIGINT NOT NULL,
  wagering_required BIGINT NOT NULL DEFAULT 0,
  wagering_done     BIGINT NOT NULL DEFAULT 0,
  status            bonus_status NOT NULL DEFAULT 'active',
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, promotion_id)
);

CREATE INDEX ON user_bonuses (user_id) WHERE status = 'active';

-- Accumulator bonus ladder: legs → multiplier.
CREATE TABLE acca_bonus_tiers (
  min_legs      INT PRIMARY KEY,
  multiplier    NUMERIC(6,4) NOT NULL,
  min_leg_odds  NUMERIC(6,3) NOT NULL DEFAULT 1.20
);

-- =====================================================================
-- 9. JACKPOTS
-- =====================================================================

CREATE TABLE jackpots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  legs            INT NOT NULL,
  stake_kobo      BIGINT NOT NULL,
  prize_pool_kobo BIGINT NOT NULL,
  closes_at       TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE jackpot_fixtures (
  jackpot_id  UUID NOT NULL REFERENCES jackpots(id) ON DELETE CASCADE,
  event_id    UUID NOT NULL REFERENCES events(id),
  position    INT NOT NULL,
  result      TEXT,                        -- '1', 'X', '2'
  PRIMARY KEY (jackpot_id, position)
);

CREATE TABLE jackpot_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jackpot_id  UUID NOT NULL REFERENCES jackpots(id),
  user_id     UUID NOT NULL REFERENCES users(id),
  picks       CHAR(1)[] NOT NULL,
  correct     INT,
  payout_kobo BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON jackpot_entries (jackpot_id, correct DESC);

-- =====================================================================
-- 10. RISK AND AUDIT
-- =====================================================================

-- Punters who consistently beat the closing line. Not a punishment
-- list — a signal to review limits before the exposure compounds.
CREATE TABLE user_risk_profiles (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  clv_score         NUMERIC(8,4),          -- avg closing line value
  stake_factor      NUMERIC(4,2) NOT NULL DEFAULT 1.0,  -- multiplier on max stake
  flags             TEXT[] NOT NULL DEFAULT '{}',
  reviewed_at       TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id    UUID,
  actor_type  TEXT NOT NULL,               -- 'user', 'admin', 'system'
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  before      JSONB,
  after       JSONB,
  ip          INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON audit_log (entity, entity_id, created_at DESC);
CREATE INDEX ON audit_log (actor_id, created_at DESC);

-- =====================================================================
-- 11. VIEWS THE APP ACTUALLY QUERIES
-- =====================================================================

CREATE VIEW v_user_balance AS
SELECT u.id AS user_id,
       COALESCE(SUM(b.balance_kobo) FILTER (WHERE b.kind = 'user_cash'), 0)   AS cash_kobo,
       COALESCE(SUM(b.balance_kobo) FILTER (WHERE b.kind = 'user_bonus'), 0)  AS bonus_kobo,
       COALESCE(SUM(b.balance_kobo) FILTER (WHERE b.kind = 'user_locked'), 0) AS locked_kobo
FROM users u
LEFT JOIN account_balances b ON b.user_id = u.id
GROUP BY u.id;

CREATE VIEW v_open_bets AS
SELECT b.id, b.user_id, b.stake_kobo, b.total_odds, b.potential_return,
       b.created_at, COUNT(l.id) AS legs,
       COUNT(l.id) FILTER (WHERE l.status = 'won') AS legs_won
FROM bets b
JOIN bet_legs l ON l.bet_id = b.id
WHERE b.status = 'open'
GROUP BY b.id;

-- =====================================================================
-- 12. SEED
-- =====================================================================

INSERT INTO sports (id, name, sort) VALUES
  ('football', 'Football', 1),
  ('basketball', 'Basketball', 2),
  ('tennis', 'Tennis', 3)
ON CONFLICT DO NOTHING;

INSERT INTO acca_bonus_tiers (min_legs, multiplier) VALUES
  (3, 1.03), (5, 1.08), (7, 1.15), (10, 1.30),
  (13, 1.60), (16, 2.10), (20, 2.70)
ON CONFLICT DO NOTHING;

-- =====================================================================
-- NOTES
-- =====================================================================
-- * odds_history needs a monthly partition created ahead of time. Run
--   pg_partman or a cron job; a missing partition is a hard insert error.
-- * account_balances is a materialised view for convenience. Under real
--   load, replace it with a balance snapshot table updated in the same
--   transaction as the entries, plus a nightly reconciliation job that
--   recomputes from ledger_entries and alerts on any drift.
-- * bet_legs copies price and labels deliberately. Joining to live
--   outcomes for bet history means a punter's settled ticket changes
--   its own wording when you rename a market.
-- * Keep raw BVN and NIN out of this database entirely. Store the hash,
--   verify through the provider, discard the plaintext.
