// What this module owns: queries for the weekly weekend digest email campaign.
// Does NOT own email templates (services/weekend-digest-email.js) or generic
// transactional send logic (services/email.js).

'use strict';

const pool = require('./index');

/**
 * ISO week string for a given date: e.g. '2026-W22'
 * Used as the idempotency key — one digest per user per week.
 */
function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Thursday in current week determines ISO year
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Returns all real users who have NOT yet received the digest for the given week.
 * Excludes test accounts, @polsia.app addresses, and users without email.
 * Includes a boolean `used_firstsession50` so the template can branch on CTA.
 */
async function getUsersForDigest(weekKey) {
  const result = await pool.query(`
    SELECT
      u.id,
      u.email,
      u.name,
      u.location,
      u.surf_level,
      EXISTS (
        SELECT 1 FROM promo_redemptions pr
        WHERE pr.user_id = u.id AND pr.code = 'FIRSTSESSION50'
      ) AS used_firstsession50,
      u.referral_code
    FROM users u
    WHERE u.email IS NOT NULL
      AND u.email != ''
      AND u.email NOT ILIKE '%@polsia.app'
      AND u.email NOT ILIKE '%@mailinator.com'
      AND u.id != 9
      AND (u.name IS NULL OR (
        u.name NOT ILIKE 'Test%'
        AND u.name NOT ILIKE 'QA%'
        AND u.name NOT ILIKE '%Test Rider%'
        AND u.name NOT ILIKE '%Test Host%'
      ))
      AND NOT EXISTS (
        SELECT 1 FROM weekend_digest_sends wds
        WHERE wds.user_id = u.id AND wds.week_number = $1
      )
    ORDER BY u.created_at ASC
  `, [weekKey]);
  return result.rows;
}

/**
 * Returns up to 3 boards available on both Saturday AND Sunday next week.
 * Availability = not blocked in board_blocked_dates AND no overlapping confirmed bookings.
 * Ordered by: verified host first, then hourly price ascending, then most recently listed.
 */
async function getWeekendBoards(satDate, sunDate, limit = 3) {
  const result = await pool.query(`
    SELECT
      b.id,
      b.title,
      b.board_type,
      b.hourly_rate_cents,
      b.photos,
      b.location,
      b.spot_id,
      s.name AS spot_name,
      s.slug AS spot_slug,
      u.name AS host_name,
      u.stripe_charges_enabled AS verified_host,
      u.identity_status AS host_identity_status,
      -- Verified = Stripe + KYC + ≥3 photos
      CASE WHEN u.stripe_charges_enabled = true
            AND u.identity_status = 'verified'
            AND jsonb_array_length(COALESCE(b.photos, '[]'::jsonb)) >= 3
           THEN true ELSE false
      END AS is_verified_host
    FROM boards b
    JOIN users u ON u.id = b.host_id
    LEFT JOIN surf_spots s ON s.id = b.spot_id
    WHERE b.is_listed = true
      -- Must be free on Saturday
      AND NOT EXISTS (
        SELECT 1 FROM board_blocked_dates bd
        WHERE bd.board_id = b.id AND bd.blocked_date = $1::date
      )
      AND NOT EXISTS (
        SELECT 1 FROM bookings bk
        WHERE bk.board_id = b.id
          AND bk.status NOT IN ('cancelled', 'expired')
          AND NOT (bk.status = 'pending' AND bk.pending_at < NOW() - INTERVAL '30 minutes')
          AND bk.start_date <= $1::date AND bk.end_date >= $1::date
      )
      -- Must be free on Sunday too
      AND NOT EXISTS (
        SELECT 1 FROM board_blocked_dates bd2
        WHERE bd2.board_id = b.id AND bd2.blocked_date = $2::date
      )
      AND NOT EXISTS (
        SELECT 1 FROM bookings bk2
        WHERE bk2.board_id = b.id
          AND bk2.status NOT IN ('cancelled', 'expired')
          AND NOT (bk2.status = 'pending' AND bk2.pending_at < NOW() - INTERVAL '30 minutes')
          AND bk2.start_date <= $2::date AND bk2.end_date >= $2::date
      )
    ORDER BY is_verified_host DESC, b.hourly_rate_cents ASC NULLS LAST, b.created_at DESC
    LIMIT $3
  `, [satDate, sunDate, limit]);
  return result.rows;
}

/**
 * Returns up to 2 spots that have at least 1 listed board available this weekend.
 * Ordered randomly so the digest rotates variety across sends.
 */
async function getWeekendSpots(satDate, sunDate, limit = 2) {
  const result = await pool.query(`
    SELECT DISTINCT ON (s.id)
      s.id,
      s.name,
      s.slug,
      s.wave_type,
      s.level,
      s.latitude,
      s.longitude
    FROM surf_spots s
    WHERE EXISTS (
      SELECT 1 FROM boards b
      WHERE b.spot_id = s.id
        AND b.is_listed = true
        -- Free on Saturday
        AND NOT EXISTS (
          SELECT 1 FROM board_blocked_dates bd
          WHERE bd.board_id = b.id AND bd.blocked_date = $1::date
        )
        AND NOT EXISTS (
          SELECT 1 FROM bookings bk
          WHERE bk.board_id = b.id
            AND bk.status NOT IN ('cancelled', 'expired')
            AND bk.start_date <= $1::date AND bk.end_date >= $1::date
        )
        -- Free on Sunday
        AND NOT EXISTS (
          SELECT 1 FROM board_blocked_dates bd2
          WHERE bd2.board_id = b.id AND bd2.blocked_date = $2::date
        )
        AND NOT EXISTS (
          SELECT 1 FROM bookings bk2
          WHERE bk2.board_id = b.id
            AND bk2.status NOT IN ('cancelled', 'expired')
            AND bk2.start_date <= $2::date AND bk2.end_date >= $2::date
        )
    )
    ORDER BY s.id, RANDOM()
    LIMIT $3
  `, [satDate, sunDate, limit]);
  return result.rows;
}

/**
 * Record that a user was sent the digest for a given week.
 * ON CONFLICT DO NOTHING = idempotent.
 */
async function markDigestSent(userId, weekKey) {
  await pool.query(`
    INSERT INTO weekend_digest_sends (user_id, week_number, sent_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (user_id, week_number) DO NOTHING
  `, [userId, weekKey]);
}

/**
 * Append a send/open/click event to email_events.
 * Fire-and-forget — caller handles the rejected promise.
 */
async function logEmailEvent(userId, email, campaign, eventType, messageId, url = null) {
  await pool.query(`
    INSERT INTO email_events (user_id, email, campaign, event_type, message_id, url)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [userId, email, campaign, eventType, messageId, url]);
}

module.exports = {
  isoWeekKey,
  getUsersForDigest,
  getWeekendBoards,
  getWeekendSpots,
  markDigestSent,
  logEmailEvent,
};
