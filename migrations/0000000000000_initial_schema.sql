-- Initial schema for Swell — reconstructed from db/*.js and routes/*.js
-- safe to re-run: DROP only for users (template Polsia obsolète, no real data)
-- session and _migrations are never touched here

-- ─────────────────────────────────────────────────────────────────────────────
-- users  (DROP + recreate: old table is the Polsia subscription template)
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
  id                              SERIAL PRIMARY KEY,
  email                           VARCHAR(255) NOT NULL,
  name                            VARCHAR(255),
  password_hash                   VARCHAR(255),
  password_needs_rehash           BOOLEAN DEFAULT false,
  is_host                         BOOLEAN DEFAULT false,
  avatar_url                      TEXT,
  bio                             TEXT,
  surf_level                      VARCHAR(50),
  location                        VARCHAR(255),
  host_since                      TIMESTAMPTZ,
  best_surf_trip_text             TEXT,
  email_verified                  BOOLEAN DEFAULT false,
  email_verification_token        VARCHAR(255),
  email_token_expires_at          TIMESTAMPTZ,
  identity_status                 VARCHAR(50),
  identity_doc_url                TEXT,
  identity_doc_back_url           TEXT,
  identity_submitted_at           TIMESTAMPTZ,
  identity_verified_at            TIMESTAMPTZ,
  identity_provider               VARCHAR(100),
  stripe_account_id               VARCHAR(255),
  stripe_charges_enabled          BOOLEAN DEFAULT false,
  stripe_payouts_enabled          BOOLEAN DEFAULT false,
  stripe_onboarding_completed_at  TIMESTAMPTZ,
  phone                           VARCHAR(50),
  iban_encrypted                  TEXT,
  iban_last4                      VARCHAR(4),
  bank_account_name               VARCHAR(255),
  referral_code                   VARCHAR(20) UNIQUE,
  referred_by_user_id             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  referral_credit_cents           INTEGER DEFAULT 0,
  average_rating                  NUMERIC(3,2),
  review_count                    INTEGER DEFAULT 0,
  created_at                      TIMESTAMPTZ DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX users_email_unique_idx ON users (LOWER(email));
CREATE INDEX users_referral_code_idx ON users (referral_code);
CREATE INDEX users_stripe_account_id_idx ON users (stripe_account_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- surf_spots
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS surf_spots (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  slug        VARCHAR(255) UNIQUE NOT NULL,
  region      VARCHAR(255),
  latitude    NUMERIC(10,7),
  longitude   NUMERIC(10,7),
  wave_type   VARCHAR(100),
  level       VARCHAR(100),
  description TEXT
);

-- ─────────────────────────────────────────────────────────────────────────────
-- boards
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS boards (
  id                    SERIAL PRIMARY KEY,
  host_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title                 VARCHAR(255),
  description           TEXT,
  board_type            VARCHAR(100),
  length_ft             NUMERIC(4,2),
  condition             VARCHAR(50),
  daily_price_cents     INTEGER,
  hourly_rate_cents     INTEGER,
  location              VARCHAR(255),
  region                VARCHAR(100) DEFAULT 'hossegor',
  latitude              NUMERIC(10,7),
  longitude             NUMERIC(10,7),
  photos                JSONB DEFAULT '[]',
  fins_included         BOOLEAN DEFAULT false,
  leash_included        BOOLEAN DEFAULT false,
  bag_included          BOOLEAN DEFAULT false,
  skill_level           VARCHAR(50) DEFAULT 'all',
  damage_waiver_enabled BOOLEAN DEFAULT true,
  spot_id               INTEGER REFERENCES surf_spots(id) ON DELETE SET NULL,
  estimated_value_cents INTEGER,
  is_listed             BOOLEAN DEFAULT true,
  pickup_instructions   TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX boards_host_id_idx    ON boards (host_id);
CREATE INDEX boards_spot_id_idx    ON boards (spot_id);
CREATE INDEX boards_is_listed_idx  ON boards (is_listed);

-- ─────────────────────────────────────────────────────────────────────────────
-- bookings
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id                          SERIAL PRIMARY KEY,
  board_id                    INTEGER NOT NULL REFERENCES boards(id) ON DELETE RESTRICT,
  renter_id                   INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  start_date                  DATE,
  end_date                    DATE,
  start_time                  TIME,
  end_time                    TIME,
  duration_hours              INTEGER,
  total_cents                 INTEGER,
  damage_waiver_cents         INTEGER DEFAULT 0,
  message                     TEXT,
  promo_code                  VARCHAR(50),
  promo_discount_cents        INTEGER DEFAULT 0,
  status                      VARCHAR(20) DEFAULT 'pending',
  stripe_session_id           VARCHAR(255),
  stripe_payment_link         TEXT,
  deposit_amount_cents        INTEGER DEFAULT 0,
  deposit_session_id          VARCHAR(255),
  deposit_payment_intent_id   VARCHAR(255),
  deposit_status              VARCHAR(30) DEFAULT 'none',
  deposit_captured_at         TIMESTAMPTZ,
  deposit_refund_at           TIMESTAMPTZ,
  post_session_email_sent_at  TIMESTAMPTZ,
  reminder_sent_at            TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX bookings_board_id_idx   ON bookings (board_id);
CREATE INDEX bookings_renter_id_idx  ON bookings (renter_id);
CREATE INDEX bookings_status_idx     ON bookings (status);
CREATE INDEX bookings_start_date_idx ON bookings (start_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- board_blocked_dates
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS board_blocked_dates (
  id           SERIAL PRIMARY KEY,
  board_id     INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  blocked_date DATE NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (board_id, blocked_date)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- board_blocked_slots
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS board_blocked_slots (
  id           SERIAL PRIMARY KEY,
  board_id     INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  blocked_date DATE NOT NULL,
  start_hour   INTEGER NOT NULL,
  end_hour     INTEGER NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (board_id, blocked_date, start_hour, end_hour)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- messages
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id         SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  sender_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX messages_booking_id_idx ON messages (booking_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- reviews
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id            SERIAL PRIMARY KEY,
  booking_id    INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  board_id      INTEGER REFERENCES boards(id) ON DELETE SET NULL,
  reviewer_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewee_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewer_role VARCHAR(10) NOT NULL,
  rating        NUMERIC(2,1),
  rating_details JSONB DEFAULT '{}',
  comment       TEXT,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX reviews_booking_id_idx  ON reviews (booking_id);
CREATE INDEX reviews_reviewee_id_idx ON reviews (reviewee_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- booking_inspections
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS booking_inspections (
  id           SERIAL PRIMARY KEY,
  booking_id   INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  type         VARCHAR(20) NOT NULL,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  photos       JSONB DEFAULT '[]',
  notes        TEXT,
  latitude     NUMERIC(10,7),
  longitude    NUMERIC(10,7),
  confirmed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (booking_id, type, user_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- partners
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partners (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(255),
  type            VARCHAR(100),
  location        VARCHAR(255),
  email           VARCHAR(255),
  phone           VARCHAR(50),
  fleet_estimate  VARCHAR(50),
  website         VARCHAR(255),
  message         TEXT,
  status          VARCHAR(20) DEFAULT 'pending',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- promo_codes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promo_codes (
  id                  SERIAL PRIMARY KEY,
  code                VARCHAR(50) UNIQUE NOT NULL,
  discount_pct        NUMERIC(5,2),
  max_discount_cents  INTEGER,
  active              BOOLEAN DEFAULT true,
  valid_until         TIMESTAMPTZ,
  hourly_only         BOOLEAN DEFAULT false,
  single_use_per_user BOOLEAN DEFAULT false,
  first_booking_only  BOOLEAN DEFAULT false,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- promo_redemptions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promo_redemptions (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id     INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  code           VARCHAR(50) NOT NULL,
  discount_cents INTEGER,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, code)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- referral_redemptions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_redemptions (
  id                   SERIAL PRIMARY KEY,
  inviter_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invitee_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id           INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  inviter_credit_cents INTEGER DEFAULT 0,
  invitee_credit_cents INTEGER DEFAULT 0,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (invitee_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- board_genomes  (SWELL_GENOME)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS board_genomes (
  id                      SERIAL PRIMARY KEY,
  board_id                INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  genome_id               VARCHAR(20) UNIQUE NOT NULL,
  shape                   VARCHAR(100),
  construction            VARCHAR(100),
  shaper                  VARCHAR(100),
  brand_model             VARCHAR(255),
  value_estimate          INTEGER,
  fragility_profile       VARCHAR(50),
  preferred_wave_range    VARCHAR(100),
  damage_history          JSONB DEFAULT '[]',
  profit_history          JSONB DEFAULT '[]',
  survival_score          NUMERIC(5,2) DEFAULT 100,
  rental_count            INTEGER DEFAULT 0,
  life_expectancy_estimate INTEGER,
  roi_class               VARCHAR(5),
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (board_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- rental_events  (SWELL_EVENT_STORE — append-only, never UPDATE or DELETE)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rental_events (
  id                              SERIAL PRIMARY KEY,
  event_id                        VARCHAR(20) UNIQUE NOT NULL,
  booking_id                      INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  board_id                        INTEGER REFERENCES boards(id) ON DELETE SET NULL,
  spot_id                         INTEGER REFERENCES surf_spots(id) ON DELETE SET NULL,
  rider_id                        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  weather                         VARCHAR(100),
  swell_height                    NUMERIC(4,2),
  swell_period                    NUMERIC(4,1),
  swell_direction                 VARCHAR(20),
  rider_level                     VARCHAR(50),
  rider_experience_rented_board_type BOOLEAN,
  return_condition                VARCHAR(50),
  micro_impacts                   JSONB DEFAULT '[]',
  return_time_delta               INTEGER,
  satisfaction_score              NUMERIC(3,1),
  hidden_cost_cents               INTEGER DEFAULT 0,
  incident_reported               BOOLEAN DEFAULT false,
  risk_score                      NUMERIC(5,2),
  created_at                      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX rental_events_board_id_idx ON rental_events (board_id);
CREATE INDEX rental_events_spot_id_idx  ON rental_events (spot_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- failure_zones  (SWELL_FAILURE_ATLAS)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS failure_zones (
  id                     SERIAL PRIMARY KEY,
  spot_id                INTEGER REFERENCES surf_spots(id) ON DELETE SET NULL,
  zone_name              VARCHAR(255),
  damage_multiplier      NUMERIC(4,2) DEFAULT 1.0,
  rider_level_warning    VARCHAR(100),
  dominant_damage_types  JSONB DEFAULT '[]',
  worst_board_types      JSONB DEFAULT '[]',
  recommended_board_types JSONB DEFAULT '[]',
  incident_count         INTEGER DEFAULT 0,
  avg_repair_cost_cents  INTEGER DEFAULT 0,
  data_source            VARCHAR(20) DEFAULT 'expert',
  last_updated           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- host_metrics  (HOST_EVOLUTION_ENGINE)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS host_metrics (
  id                      SERIAL PRIMARY KEY,
  host_id                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trust_score             NUMERIC(5,2) DEFAULT 50,
  board_quality_avg       NUMERIC(3,2),
  repeat_rentals_pct      NUMERIC(5,2),
  low_incident_rate_pct   NUMERIC(5,2),
  response_time_avg_min   INTEGER,
  payout_completion_rate  NUMERIC(5,2),
  total_rentals           INTEGER DEFAULT 0,
  total_revenue_cents     INTEGER DEFAULT 0,
  active_boards           INTEGER DEFAULT 0,
  community_pull          INTEGER DEFAULT 0,
  tier                    VARCHAR(20) DEFAULT 'GROWTH_HOST',
  evolution_trend         VARCHAR(20) DEFAULT 'stable',
  next_tier_requirements  JSONB DEFAULT '[]',
  prev_trust_score        NUMERIC(5,2),
  prev_tier               VARCHAR(20),
  metrics_updated_at      TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (host_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- consent_log  (RGPD)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consent_log (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  session_id VARCHAR(255),
  consent    JSONB,
  ip_hash    VARCHAR(64),
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX consent_log_user_id_idx    ON consent_log (user_id);
CREATE INDEX consent_log_created_at_idx ON consent_log (created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- email_logs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_logs (
  id             SERIAL PRIMARY KEY,
  booking_id     INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  recipient_type VARCHAR(20),
  email          VARCHAR(255),
  subject        VARCHAR(500),
  tag            VARCHAR(100),
  status         VARCHAR(20),
  error_message  TEXT,
  sent_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX email_logs_booking_id_idx ON email_logs (booking_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- weekend_digest_sends  (idempotency — one row per user per week)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weekend_digest_sends (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_number VARCHAR(10) NOT NULL,
  sent_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, week_number)
);
