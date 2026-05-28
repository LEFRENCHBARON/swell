// What this module owns: all review queries — creation, retrieval, publication logic.
// Does NOT validate booking ownership or session auth — that's the route layer's job.
// Double-blind: reviews are stored immediately but only published when both parties have
// submitted, or after 7 days with a single review.
const pool = require('./index');

// Submit a review. Returns the created row (unpublished until partner submits or 7 days pass).
async function createReview({ bookingId, boardId, reviewerId, revieweeId, reviewerRole, rating, ratingDetails, comment }) {
  const result = await pool.query(`
    INSERT INTO reviews (booking_id, board_id, reviewer_id, reviewee_id, reviewer_role, rating, rating_details, comment, review_type)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [bookingId, boardId, reviewerId, revieweeId, reviewerRole || 'renter', rating, JSON.stringify(ratingDetails || {}), comment, reviewerRole === 'host' ? 'host_review' : 'board']);
  return result.rows[0];
}

// Check if this user has already submitted a review for this booking.
async function hasReviewedBooking(bookingId, reviewerId) {
  const result = await pool.query(
    'SELECT id FROM reviews WHERE booking_id = $1 AND reviewer_id = $2',
    [bookingId, reviewerId]
  );
  return result.rows.length > 0;
}

// Get both review rows for a booking (renter's + host's). Used to check if both submitted.
async function getReviewsForBooking(bookingId) {
  const result = await pool.query(
    'SELECT * FROM reviews WHERE booking_id = $1 ORDER BY created_at ASC',
    [bookingId]
  );
  return result.rows;
}

// Publish both reviews for a booking and update denormalized rating columns on both users.
// Called after the second party submits, or by a scheduled job after 7 days.
async function publishReviewsForBooking(bookingId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Mark both as published
    await client.query(`
      UPDATE reviews SET published_at = NOW()
      WHERE booking_id = $1 AND published_at IS NULL
    `, [bookingId]);

    // Recompute denormalized ratings for all affected users in this booking
    await client.query(`
      UPDATE users u SET
        average_rating = COALESCE((
          SELECT ROUND(AVG(r.rating)::NUMERIC, 1) FROM reviews r
          WHERE r.reviewee_id = u.id AND r.published_at IS NOT NULL
        ), 0),
        review_count = (
          SELECT COUNT(*) FROM reviews r
          WHERE r.reviewee_id = u.id AND r.published_at IS NOT NULL
        )
      WHERE u.id IN (
        SELECT DISTINCT reviewee_id FROM reviews WHERE booking_id = $1
      )
    `, [bookingId]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Get published reviews for a user's profile (received reviews only).
async function getReviewsForUser(userId) {
  const result = await pool.query(`
    SELECT r.*, u.name AS reviewer_name, u.avatar_url AS reviewer_avatar,
      b.title AS board_title
    FROM reviews r
    JOIN users u ON u.id = r.reviewer_id
    LEFT JOIN boards b ON b.id = r.board_id
    WHERE r.reviewee_id = $1 AND r.published_at IS NOT NULL
    ORDER BY r.published_at DESC
  `, [userId]);
  return result.rows;
}

// Get published reviews for a board (renter→board reviews only).
// Board aggregation uses this for display on listing cards and detail view.
async function getPublishedReviewsForBoard(boardId) {
  const result = await pool.query(`
    SELECT r.*, u.name AS reviewer_name, u.avatar_url AS reviewer_avatar
    FROM reviews r
    JOIN users u ON u.id = r.reviewer_id
    WHERE r.board_id = $1 AND r.reviewer_role = 'renter' AND r.published_at IS NOT NULL
    ORDER BY r.published_at DESC
  `, [boardId]);
  return result.rows;
}

// Check if 7-day auto-publish window has passed for any single-sided reviews.
// Returns bookings that have at least one review and are past the 7-day mark.
async function getStaleUnpublishedBookings() {
  const result = await pool.query(`
    SELECT DISTINCT booking_id
    FROM reviews
    WHERE published_at IS NULL
      AND created_at < NOW() - INTERVAL '7 days'
  `);
  return result.rows.map(r => r.booking_id);
}

module.exports = {
  createReview,
  hasReviewedBooking,
  getReviewsForBooking,
  publishReviewsForBooking,
  getReviewsForUser,
  getPublishedReviewsForBoard,
  getStaleUnpublishedBookings,
};
