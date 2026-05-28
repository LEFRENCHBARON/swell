// What this module owns: bookings table queries and date conflict checks.
// Does NOT handle payment processing or HTTP responses.
const pool = require('./index');
const { isRangeAvailable } = require('./availability');

async function checkAvailability(boardId, startDate, endDate, excludeBookingId = null) {
  const params = [boardId, startDate, endDate];
  let excludeClause = '';
  if (excludeBookingId) {
    params.push(excludeBookingId);
    excludeClause = `AND id != $${params.length}`;
  }

  // Check 1: no confirmed/non-stale-pending bookings overlap.
  // 'cancelled' and 'expired' statuses never block availability.
  // Pending bookings >30 min old are treated as expired at query time (belt-and-suspenders
  // alongside the formal expire-stale-bookings cron that transitions status).
  const result = await pool.query(`
    SELECT COUNT(*) AS conflicts
    FROM bookings
    WHERE board_id = $1
      AND status NOT IN ('cancelled', 'expired')
      AND NOT (status = 'pending' AND pending_at < NOW() - INTERVAL '30 minutes')
      AND NOT (end_date <= $2 OR start_date >= $3)
      ${excludeClause}
  `, params);
  if (parseInt(result.rows[0].conflicts) > 0) return false;

  // Check 2: no host-blocked dates in the range
  const hostAvailable = await isRangeAvailable(boardId, startDate, endDate);
  return hostAvailable;
}

async function getBookedDates(boardId) {
  const result = await pool.query(`
    SELECT start_date, end_date
    FROM bookings
    WHERE board_id = $1
      AND status NOT IN ('cancelled', 'expired')
      AND NOT (status = 'pending' AND pending_at < NOW() - INTERVAL '30 minutes')
    ORDER BY start_date
  `, [boardId]);
  return result.rows;
}

async function createBooking({ boardId, renterId, startDate, endDate, startTime, endTime, durationHours, totalCents, damageWaiverCents, message, promoCode, promoDiscountCents }) {
  const result = await pool.query(`
    INSERT INTO bookings (board_id, renter_id, start_date, end_date, start_time, end_time, duration_hours, total_cents, damage_waiver_cents, message, promo_code, promo_discount_cents, status, pending_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', NOW())
    RETURNING *
  `, [boardId, renterId, startDate, endDate, startTime || null, endTime || null, durationHours || null, totalCents, damageWaiverCents || 0, message, promoCode || null, promoDiscountCents || null]);
  return result.rows[0];
}

async function getBookingById(id) {
  const result = await pool.query(`
    SELECT bk.*, b.title AS board_title, b.host_id, b.daily_price_cents, b.photos,
      renter.name AS renter_name, renter.email AS renter_email,
      host.name AS host_name, host.email AS host_email
    FROM bookings bk
    JOIN boards b ON b.id = bk.board_id
    JOIN users renter ON renter.id = bk.renter_id
    JOIN users host ON host.id = b.host_id
    WHERE bk.id = $1
  `, [id]);
  return result.rows[0] || null;
}

async function updateBookingStatus(id, status, userId) {
  // Only host or renter can update status
  const result = await pool.query(`
    UPDATE bookings bk
    SET status = $2, updated_at = NOW()
    FROM boards b
    WHERE bk.id = $1
      AND b.id = bk.board_id
      AND (bk.renter_id = $3 OR b.host_id = $3)
    RETURNING bk.*
  `, [id, status, userId]);
  return result.rows[0] || null;
}

async function getBookingsForRenter(renterId) {
  const result = await pool.query(`
    SELECT bk.*, b.title AS board_title, b.photos, b.location,
      host.name AS host_name, host.avatar_url AS host_avatar,
      renter_review.rating AS review_rating,
      renter_review.id IS NOT NULL AS has_reviewed
    FROM bookings bk
    JOIN boards b ON b.id = bk.board_id
    JOIN users host ON host.id = b.host_id
    LEFT JOIN reviews renter_review ON renter_review.booking_id = bk.id AND renter_review.reviewer_id = $1
    WHERE bk.renter_id = $1
    ORDER BY bk.start_date DESC
  `, [renterId]);
  return result.rows;
}

async function getBookingsForHost(hostId) {
  const result = await pool.query(`
    SELECT bk.*, b.title AS board_title, b.photos,
      renter.name AS renter_name, renter.avatar_url AS renter_avatar, renter.email AS renter_email,
      host_review.id IS NOT NULL AS has_reviewed
    FROM bookings bk
    JOIN boards b ON b.id = bk.board_id
    JOIN users renter ON renter.id = bk.renter_id
    LEFT JOIN reviews host_review ON host_review.booking_id = bk.id AND host_review.reviewer_id = $1
    WHERE b.host_id = $1
    ORDER BY bk.start_date DESC
  `, [hostId]);
  return result.rows;
}

async function updateBookingPayment(id, { paymentStatus, stripeSessionId, stripePaymentLink }) {
  const result = await pool.query(`
    UPDATE bookings
    SET payment_status = $2, stripe_session_id = $3, stripe_payment_link = $4, updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [id, paymentStatus, stripeSessionId, stripePaymentLink]);
  return result.rows[0] || null;
}

async function getBookingBySessionId(sessionId) {
  const result = await pool.query(`
    SELECT bk.*, b.title AS board_title, b.host_id, b.daily_price_cents, b.photos, b.location, b.pickup_instructions,
      renter.name AS renter_name, renter.email AS renter_email,
      host.name AS host_name, host.email AS host_email, host.phone AS host_phone
    FROM bookings bk
    JOIN boards b ON b.id = bk.board_id
    JOIN users renter ON renter.id = bk.renter_id
    JOIN users host ON host.id = b.host_id
    WHERE bk.stripe_session_id = $1
  `, [sessionId]);
  return result.rows[0] || null;
}

// deposit_status values: 'none' | 'pending_hold' | 'held' | 'released' | 'captured' | 'partial_capture'
// deposit_session_id stores the Stripe PaymentIntent ID for manual-capture PIs
async function updateBookingDeposit(id, { depositAmountCents, depositSessionId, depositStatus, depositRefundAt }) {
  const result = await pool.query(`
    UPDATE bookings
    SET deposit_amount_cents = $2,
        deposit_session_id = $3,
        deposit_status = $4,
        deposit_refund_at = $5,
        deposit_payment_intent_id = COALESCE(deposit_payment_intent_id, $3),
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [id, depositAmountCents, depositSessionId, depositStatus, depositRefundAt || null]);
  return result.rows[0] || null;
}

// Transition stale pending bookings (>30 min old) to 'expired' status.
// Returns updated rows. Called by jobs/expire-stale-bookings.js.
async function expireStalePendingBookings() {
  const result = await pool.query(`
    UPDATE bookings
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'pending'
      AND pending_at < NOW() - INTERVAL '30 minutes'
    RETURNING id, board_id, renter_id, start_date, end_date
  `);
  return result.rows;
}

// Find bookings whose deposit hold window has expired and should be auto-released.
// Called by the /api/deposits/cron endpoint (secured by CRON_SECRET).
async function getExpiredDepositBookings() {
  const result = await pool.query(`
    SELECT bk.*, b.title AS board_title
    FROM bookings bk
    JOIN boards b ON b.id = bk.board_id
    WHERE bk.deposit_status = 'held'
      AND bk.deposit_refund_at IS NOT NULL
      AND bk.deposit_refund_at <= NOW()
  `);
  return result.rows;
}

async function releaseBookingDeposit(id) {
  const result = await pool.query(`
    UPDATE bookings
    SET deposit_status = 'released', updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [id]);
  return result.rows[0] || null;
}

async function captureBookingDeposit(id, capturedAmountCents) {
  const result = await pool.query(`
    UPDATE bookings
    SET deposit_status = $2,
        deposit_amount_cents = $3,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [id, capturedAmountCents > 0 ? 'captured' : 'released', capturedAmountCents]);
  return result.rows[0] || null;
}

// Full denormalized read for confirmation emails — returns all contact + logistics info
// both parties need immediately after payment: phone numbers, avatars, board thumbnail, spot.
async function getBookingConfirmationData(bookingId) {
  const result = await pool.query(`
    SELECT
      bk.*,
      -- board
      b.title AS board_title,
      b.board_type,
      b.length_ft,
      b.photos AS board_photos,
      b.location AS board_location,
      b.pickup_instructions,
      b.hourly_rate_cents,
      b.daily_price_cents,
      b.damage_waiver_enabled,
      b.estimated_value_cents,
      -- spot
      s.name AS spot_name,
      -- renter
      renter.name  AS renter_name,
      renter.email AS renter_email,
      renter.phone AS renter_phone,
      renter.avatar_url AS renter_avatar,
      -- host
      host.name    AS host_name,
      host.email   AS host_email,
      host.phone   AS host_phone,
      host.avatar_url AS host_avatar
    FROM bookings bk
    JOIN boards b       ON b.id     = bk.board_id
    JOIN users  renter  ON renter.id = bk.renter_id
    JOIN users  host    ON host.id   = b.host_id
    LEFT JOIN surf_spots s ON s.id  = b.spot_id
    WHERE bk.id = $1
  `, [bookingId]);
  return result.rows[0] || null;
}

// Used by routes/bookings.js — for the Event Store hook on booking completion.
async function getRenterSurfLevel(bookingId) {
  const result = await pool.query(`
    SELECT u.surf_level
    FROM bookings bk
    JOIN users u ON u.id = bk.renter_id
    WHERE bk.id = $1
  `, [bookingId]);
  return result.rows[0]?.surf_level || null;
}

// Find completed bookings whose session ended 23–25h ago without a post-session email sent.
// Used by jobs/post-session-email.js — runs hourly. Returns full context for email assembly.
// end_time is a TIME column (HH:MM) stored alongside end_date (DATE) — combine via DATE + TIME arithmetic.
async function getBookingsForPostSessionEmail() {
  const result = await pool.query(`
    SELECT
      bk.id,
      bk.start_date,
      bk.end_date,
      bk.start_time,
      bk.end_time,
      -- board
      b.title AS board_title,
      b.photos AS board_photos,
      b.location AS board_location,
      -- spot
      s.name AS spot_name,
      -- renter
      renter.id   AS renter_id,
      renter.name AS renter_name,
      renter.email AS renter_email,
      renter.phone AS renter_phone,
      -- host
      host.name   AS host_name,
      host.phone  AS host_phone
    FROM bookings bk
    JOIN boards b      ON b.id      = bk.board_id
    JOIN users  renter ON renter.id = bk.renter_id
    JOIN users  host   ON host.id   = b.host_id
    LEFT JOIN surf_spots s ON s.id  = b.spot_id
    WHERE bk.status = 'completed'
      AND bk.post_session_email_sent_at IS NULL
      AND (
        -- bookings with end_time: combine date + time columns into a timestamp
        (bk.end_time IS NOT NULL
          AND (bk.end_date::date + bk.end_time::time) AT TIME ZONE 'Europe/Paris'
               BETWEEN NOW() - INTERVAL '25 hours' AND NOW() - INTERVAL '23 hours')
        OR
        -- bookings without end_time: use end_date midnight as fallback
        (bk.end_time IS NULL
          AND (bk.end_date::timestamp AT TIME ZONE 'Europe/Paris')
               BETWEEN NOW() - INTERVAL '25 hours' AND NOW() - INTERVAL '23 hours')
      )
  `);
  return result.rows;
}

// Mark a booking's post-session email as sent — idempotency guard.
async function markPostSessionEmailSent(bookingId) {
  await pool.query(
    `UPDATE bookings SET post_session_email_sent_at = NOW() WHERE id = $1`,
    [bookingId]
  );
}

// Find confirmed bookings whose session starts in 23–25h and haven't received a reminder yet.
// Returns full contact + logistics context for the reminder email.
async function getBookingsForPreSessionReminder() {
  const result = await pool.query(`
    SELECT
      bk.id,
      bk.start_date,
      bk.end_date,
      bk.start_time,
      bk.end_time,
      bk.duration_hours,
      bk.deposit_amount_cents,
      bk.deposit_status,
      bk.damage_waiver_cents,
      -- board
      b.title          AS board_title,
      b.photos         AS board_photos,
      b.location       AS board_location,
      b.pickup_instructions,
      b.damage_waiver_enabled,
      -- spot
      s.name           AS spot_name,
      s.latitude       AS lat,
      s.longitude      AS lng,
      NULL::text       AS parking_notes,
      -- renter
      renter.id        AS renter_id,
      renter.name      AS renter_name,
      renter.email     AS renter_email,
      -- host
      host.name        AS host_name,
      host.phone       AS host_phone,
      host.avatar_url  AS host_avatar
    FROM bookings bk
    JOIN boards b      ON b.id      = bk.board_id
    JOIN users  renter ON renter.id = bk.renter_id
    JOIN users  host   ON host.id   = b.host_id
    LEFT JOIN surf_spots s ON s.id  = b.spot_id
    WHERE bk.status = 'confirmed'
      AND bk.reminder_sent_at IS NULL
      AND (
        -- bookings with explicit start_time: combine date + time
        (bk.start_time IS NOT NULL
          AND (bk.start_date::date + bk.start_time::time) AT TIME ZONE 'Europe/Paris'
               BETWEEN NOW() + INTERVAL '23 hours' AND NOW() + INTERVAL '25 hours')
        OR
        -- bookings without start_time: use start_date midnight as proxy
        (bk.start_time IS NULL
          AND (bk.start_date::timestamp AT TIME ZONE 'Europe/Paris')
               BETWEEN NOW() + INTERVAL '23 hours' AND NOW() + INTERVAL '25 hours')
      )
  `);
  return result.rows;
}

// Mark a booking's pre-session reminder as sent — idempotency guard.
async function markReminderSent(bookingId) {
  await pool.query(
    `UPDATE bookings SET reminder_sent_at = NOW() WHERE id = $1`,
    [bookingId]
  );
}

module.exports = {
  checkAvailability, getBookedDates, createBooking, getBookingById,
  updateBookingStatus, getBookingsForRenter, getBookingsForHost,
  updateBookingPayment, getBookingBySessionId, getBookingConfirmationData,
  expireStalePendingBookings,
  updateBookingDeposit, getExpiredDepositBookings, releaseBookingDeposit, captureBookingDeposit,
  getRenterSurfLevel,
  getBookingsForPostSessionEmail, markPostSessionEmailSent,
  getBookingsForPreSessionReminder, markReminderSent
};
