# Swell

## What this app does
Peer-to-peer surfboard rental marketplace. Surfers list their boards for hourly rental; travelling riders find and book them by location. Launch region: Hossegor, France.

## Stack
Node.js + Express + PostgreSQL (Neon) + vanilla JS frontend, deployed on Render.

## Directory map
- `server.js` — entry point: middleware wiring and route mounts only (≤300 lines)
- `routes/` — one Express Router per domain (auth, boards, bookings, consent, deposits, profiles, seo, spots, spot-pages, listings, app-html, genome, intelligence, promo, referrals, admin, static-pages, map, track)
- `services/` — email: `email.js` (transactional send via Polsia proxy), `booking-emails.js` (confirmation templates for renter + host), `post-session-email.js` (T+24h review request), `pre-session-reminder-email.js` (T-24h session info + checklist)
- `db/` — all DB queries as named functions; `db/index.js` owns the single Pool instance
- `migrations/` — timestamp-prefixed migration files (.js or .sql), run on deploy via `npm run build`
- `public/` — static assets; `index.html` = landing page, `app.html` = full marketplace SPA, `host.html` = host dashboard, `map.html` = interactive discovery map, `blog/` = SEO blog articles; `sw.js` = service worker, `manifest.json` = PWA manifest, `icons/` = PWA icons
- `middleware/` — Express middleware: `csrf.js` (double-submit cookie CSRF protection)
- `scripts/` — build-time utilities: `generate-icons.js` (PWA PNG icon generation), `generate-brand-kit.js` (brand migration assets)
- `jobs/` — cron job entrypoints declared in `polsia.toml`: `expire-stale-bookings.js` (pending → expired), `post-session-email.js` (T+24h review prompt), `pre-session-reminder.js` (T-24h session reminder), `weekend-digest.js` (weekly digest jeudi 18h)

## Database
- `users` — auth, profile fields (bio, avatar_url, surf_level, is_host, best_surf_trip_text); identity verification: `identity_status`, `identity_doc_url`; host payment: `stripe_account_id`, `stripe_charges_enabled`, `stripe_payouts_enabled`, `stripe_onboarding_completed_at`; referral: `referral_code` (unique, short alphanumeric), `referred_by_user_id`, `referral_credit_cents`
- `boards` — board listings (type, length, condition, daily_price_cents, hourly_rate_cents, location, photos JSONB, damage_waiver_enabled, spot_id FK, is_listed default true)
- `surf_spots` — named surf spots with lat/lng, wave_type, level; 22 spots seeded (Hossegor to Hendaye)
- `bookings` — rental requests (board_id, renter_id, start_date, end_date, start_time, end_time, duration_hours, status, total_cents, damage_waiver_cents, deposit columns, post_session_email_sent_at, reminder_sent_at); hourly model with 2–16h windows
- `board_blocked_dates` — host day-level blocked dates (board_id, blocked_date); absence = available by default
- `board_blocked_slots` — host hour-level blocked slots (board_id, blocked_date, start_hour, end_hour); operating hours 6–22; unique constraint
- `messages` — chat messages scoped to a booking (booking_id, sender_id, content, read_at)
- `reviews` — double-blind bidirectional ratings: reviewer_role (renter/host), rating 1-5, rating_details JSONB, comment, published_at (NULL = pending); published when both parties review or after 7 days
- `booking_inspections` — check-in/check-out photo proofs per booking per user (type: check_in|check_out, photos JSONB, latitude/longitude, confirmed_at); immutable after creation; unique (booking_id, type, user_id)
- `partners` — B2B shop registrations (name, type, location, email, phone, fleet_estimate, website, message, status: pending/approved/active)
- `board_genomes` — SWELL_GENOME: per-board intelligence (genome_id QG-XXXXXX, shape, construction, shaper, fragility_profile, survival_score 0-100, rental_count, roi_class A+/A/B/C, damage_history JSONB, profit_history JSONB)
- `rental_events` — SWELL_EVENT_STORE: append-only rental outcomes (weather, swell, rider_level, return_condition, micro_impacts JSONB, hidden_cost_cents, risk_score)
- `failure_zones` — SWELL_FAILURE_ATLAS: spot risk profiles (damage_multiplier, dominant_damage_types JSONB, worst/recommended board types, rider_level_warning); 11 zones seeded for Hossegor/Basque coast
- `host_metrics` — HOST_EVOLUTION_ENGINE: per-host scoring (trust_score, tier: ALPHA_SHAPER/LOCAL_ICON/PREMIUM_HOST/GROWTH_HOST/AT_RISK, evolution_trend, next_tier_requirements JSONB)
- `promo_codes` — promo code definitions (code, discount_pct, max_discount_cents, single_use_per_user, first_booking_only, hourly_only, valid_until, active); seeded with FIRSTSESSION50
- `promo_redemptions` — audit log of promo usage (user_id, booking_id, code, discount_cents); used for first-use enforcement and reporting
- `referral_redemptions` — referral reward log (inviter_id, invitee_id, booking_id, inviter/invitee_credit_cents); unique on invitee_id; capped at 5 per inviter
- `email_logs` — email send/error audit log per booking per recipient (recipient_type, status, sent_at, error_message)
- `consent_log` — RGPD proof-of-consent (user_id nullable, session_id, consent JSONB, ip_hash SHA-256, user_agent, created_at); indexed by user_id and created_at
- `weekend_digest_sends` — idempotency table for weekly digest (user_id, week_number YYYY-Www); one row per user per week
- `session` — connect-pg-simple session store (auto-created)
- `_migrations` — tracks applied migrations

## External integrations
- **Polsia R2 proxy** — board and avatar photo uploads via `https://polsia.com/api/proxy/r2`
- **connect-pg-simple** — session storage in Postgres (no Redis needed)
- **Stripe via Polsia payments API** — checkout session creation (`POST /api/company-payments/checkout-session`) + verification (`GET /api/company-payments/verify`); 80/20 split, daily payouts; env: `POLSIA_API_KEY`, `POLSIA_API_URL`

## Recent changes
- 2026-05-28: CSP nonce hardening — inline onclick handlers migrated to `data-action` + delegated click listener in `app-main.js` (134 handlers in app.html, 53 in app-main.js); `routes/app-html.js` serves app.html with per-request nonce injected into script tags and strict `script-src 'nonce-XXX'` (no unsafe-inline); `server.js` refactored to 288 lines; `public/app.html` and `public/js/app-main.js` use data-action routing
- 2026-05-28: Caution = Stripe PaymentIntent pre-auth (capture_method=manual) — deposit created inside booking flow before confirmation; PI stored as `deposit_session_id`; `pending_hold` → `held` on confirmation; 48h auto-release via cron (`jobs/release-expired-deposits.js`, `*/15 * * * *`); `deposit_payment_intent_id` + `deposit_captured_at` added to bookings; `deposit_status` values: none/pending_hold/held/released/captured/partial_capture; email templates rewritten with "empreinte bancaire" and explicit "non débitée" language; `routes/deposits.js`, `db/bookings.js`, migration 1843500000000
- 2026-05-28: Email verification mandatory for sensitive actions — signup sends verification email (24h TTL); blocked: publish board, create booking (login OK, persist banner + "Renvoyer le lien" CTA); resend rate-limited 1/min/user via `POST /api/auth/resend-verification`; `email_verified` + `email_token_expires_at` on users; `db/users.js` (+getEmailTokenAge); `routes/auth.js` (+resend endpoint + improved HTML template)
- 2026-05-28: KYC admin notification on doc submission — rich HTML email to `ADMIN_NOTIFY_EMAIL` with doc thumbnails + direct link to `/admin/kyc/:userId`; badge count at `GET /api/admin/kyc-pending-count`; pending list at `GET /api/admin/kyc-pending`; Slack webhook (optional, silently skipped if `SLACK_WEBHOOK_URL` unset); `routes/identity.js`, `routes/admin.js`, migration 1843500000000
- 2026-05-28: RGPD cookie banner CNIL-compliant — explicit accept/refuse buttons at equal visual weight (min-width:100px, same border-radius); text: "Nous utilisons des cookies pour améliorer votre expérience et analyser le trafic."; pixel Meta (fbq) fires only when marketing=true in `cookie_consent` cookie; server logs consent to `consent_log` table (ip_hash SHA-256, session_id, user_agent); `routes/consent.js`, `db/consent.js`, migration 1843200000000
- 2026-05-28: Board detail /board/:id conversion sprint — sticky mobile CTA bar (fixed bottom, price + book button); social proof (bookings_count_30d pill, avg_rating/reviews, "Nouveau" badge, Verified Host badge with tooltip); urgency signals (upcoming_bookings_7d, weekend limited slots via getWeekendAvailableHours); photo lightbox (tap gallery-main, swipe/keyboard nav, thumb strip); related boards carousel (≥2 boards, scroll-snap); WhatsApp CTA (host phone, pre-filled FR message); event tracking (board_view, click_booking_widget, click_whatsapp_host, click_related_board); desktop sticky sidebar via CSS position:sticky; `routes/seo.js`, `db/boards.js` (+getWeekendAvailableHours)
