// What this module owns: messages table queries (send, fetch, mark-read, unread count).
// Does NOT handle auth checks or HTTP — that belongs in routes/messages.js.
const pool = require('./index');

/**
 * Returns all conversations for a user, grouped by booking.
 * Each conversation row contains the latest message preview and unread count.
 */
async function getConversationsForUser(userId) {
  const result = await pool.query(`
    SELECT
      bk.id              AS booking_id,
      bk.status          AS booking_status,
      bk.start_date,
      bk.end_date,
      b.title            AS board_title,
      b.photos           AS board_photos,
      -- the other party
      CASE WHEN bk.renter_id = $1 THEN host.id   ELSE renter.id   END AS other_user_id,
      CASE WHEN bk.renter_id = $1 THEN host.name ELSE renter.name END AS other_user_name,
      CASE WHEN bk.renter_id = $1 THEN host.avatar_url ELSE renter.avatar_url END AS other_user_avatar,
      CASE WHEN bk.renter_id = $1 THEN 'renter' ELSE 'host' END AS my_role,
      last_msg.content   AS last_message,
      last_msg.created_at AS last_message_at,
      last_msg.sender_id  AS last_sender_id,
      COALESCE(unread.count, 0)::int AS unread_count
    FROM bookings bk
    JOIN boards b      ON b.id = bk.board_id
    JOIN users renter  ON renter.id = bk.renter_id
    JOIN users host    ON host.id = b.host_id
    -- latest message per booking
    LEFT JOIN LATERAL (
      SELECT content, created_at, sender_id
      FROM messages
      WHERE booking_id = bk.id
      ORDER BY created_at DESC
      LIMIT 1
    ) last_msg ON TRUE
    -- unread count (messages sent by the other party, not yet read)
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS count
      FROM messages
      WHERE booking_id = bk.id
        AND sender_id != $1
        AND read_at IS NULL
    ) unread ON TRUE
    WHERE bk.renter_id = $1 OR b.host_id = $1
    ORDER BY COALESCE(last_msg.created_at, bk.created_at) DESC
  `, [userId]);
  return result.rows;
}

/**
 * Returns all messages for a booking, newest-last.
 * Caller must verify the user is a party to the booking before calling.
 */
async function getMessagesForBooking(bookingId, limit = 100, offset = 0) {
  const result = await pool.query(`
    SELECT m.id, m.booking_id, m.sender_id, m.content, m.created_at, m.read_at,
           u.name AS sender_name, u.avatar_url AS sender_avatar
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.booking_id = $1
    ORDER BY m.created_at ASC
    LIMIT $2 OFFSET $3
  `, [bookingId, limit, offset]);
  return result.rows;
}

/**
 * Inserts a new message. Returns the saved row.
 */
async function createMessage({ bookingId, senderId, content }) {
  const result = await pool.query(`
    INSERT INTO messages (booking_id, sender_id, content)
    VALUES ($1, $2, $3)
    RETURNING *
  `, [bookingId, senderId, content.trim()]);
  return result.rows[0];
}

/**
 * Marks all unread messages in a booking that were sent by someone other
 * than readerId as read. Returns the count of rows updated.
 */
async function markMessagesRead(bookingId, readerId) {
  const result = await pool.query(`
    UPDATE messages
    SET read_at = NOW()
    WHERE booking_id = $1
      AND sender_id != $2
      AND read_at IS NULL
    RETURNING id
  `, [bookingId, readerId]);
  return result.rowCount;
}

/**
 * Total unread messages across all conversations for a user.
 * Used for the nav badge.
 */
async function getTotalUnreadCount(userId) {
  const result = await pool.query(`
    SELECT COUNT(m.id)::int AS total
    FROM messages m
    JOIN bookings bk ON bk.id = m.booking_id
    JOIN boards b ON b.id = bk.board_id
    WHERE m.sender_id != $1
      AND m.read_at IS NULL
      AND (bk.renter_id = $1 OR b.host_id = $1)
  `, [userId]);
  return result.rows[0].total;
}

module.exports = {
  getConversationsForUser,
  getMessagesForBooking,
  createMessage,
  markMessagesRead,
  getTotalUnreadCount
};
