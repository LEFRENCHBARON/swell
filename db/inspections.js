// What this module owns: booking_inspections table — photo submissions for check-in/check-out.
// Does NOT own: file upload to R2 (handled in route), booking status transitions.
const pool = require('./index');

/**
 * Get all inspections for a booking (both parties, both types).
 * Returns an array ordered by type + created_at.
 */
async function getInspectionsByBooking(bookingId) {
  const result = await pool.query(`
    SELECT bi.*, u.name AS user_name, u.avatar_url AS user_avatar
    FROM booking_inspections bi
    JOIN users u ON u.id = bi.user_id
    WHERE bi.booking_id = $1
    ORDER BY bi.type, bi.created_at
  `, [bookingId]);
  return result.rows;
}

/**
 * Get a single inspection for a specific (booking, type, user) combo.
 */
async function getInspection(bookingId, type, userId) {
  const result = await pool.query(`
    SELECT * FROM booking_inspections
    WHERE booking_id = $1 AND type = $2 AND user_id = $3
  `, [bookingId, type, userId]);
  return result.rows[0] || null;
}

/**
 * Create an inspection (photos array, optional notes + geolocation).
 * Idempotent — upsert on the unique constraint (booking_id, type, user_id).
 * Photos are immutable after initial submission, so this only inserts.
 */
async function createInspection({ bookingId, type, userId, photos, notes, latitude, longitude }) {
  const result = await pool.query(`
    INSERT INTO booking_inspections (booking_id, type, user_id, photos, notes, latitude, longitude)
    VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
    ON CONFLICT (booking_id, type, user_id) DO NOTHING
    RETURNING *
  `, [bookingId, type, userId, JSON.stringify(photos || []), notes || null, latitude || null, longitude || null]);
  // If DO NOTHING triggered, return the existing row
  if (!result.rows[0]) {
    return await getInspection(bookingId, type, userId);
  }
  return result.rows[0];
}

/**
 * Mark an inspection as confirmed by the user (confirmed_at = NOW()).
 */
async function confirmInspection(bookingId, type, userId) {
  const result = await pool.query(`
    UPDATE booking_inspections
    SET confirmed_at = NOW()
    WHERE booking_id = $1 AND type = $2 AND user_id = $3
    RETURNING *
  `, [bookingId, type, userId]);
  return result.rows[0] || null;
}

/**
 * Check how many distinct users have submitted + confirmed for a (booking, type).
 * Used to determine if both parties have completed their inspection.
 */
async function getInspectionSummary(bookingId, type) {
  const result = await pool.query(`
    SELECT
      COUNT(*) AS total_submissions,
      COUNT(confirmed_at) AS total_confirmed
    FROM booking_inspections
    WHERE booking_id = $1 AND type = $2
  `, [bookingId, type]);
  return result.rows[0];
}

module.exports = {
  getInspectionsByBooking,
  getInspection,
  createInspection,
  confirmInspection,
  getInspectionSummary,
};
