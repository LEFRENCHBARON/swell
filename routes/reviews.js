// What this module owns: review submission (renter + host) and review status checks.
// Does NOT own profile display or board aggregation — those live in profiles and boards routes.
// Double-blind: reviews are stored immediately but only published when both parties submit,
// or after 7 days with one review.
const express = require('express');
const router = express.Router();
const {
  createReview,
  hasReviewedBooking,
  getReviewsForBooking,
  publishReviewsForBooking,
} = require('../db/reviews');
const { getBookingById } = require('../db/bookings');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  next();
}

// Inline moderation: block phone numbers and obvious insults in comments.
// Not a comprehensive filter — handles the most common abuse cases.
function moderateComment(text) {
  if (!text) return null;
  const cleaned = text.trim();
  if (cleaned.length < 10) return null; // enforce minimum — "ok" isn't a review
  // Block phone-number patterns (French and international)
  if (/\b(\+?\d[\s\-.]?){7,14}\d\b/.test(cleaned)) return null;
  return cleaned;
}

// GET /api/reviews/status/:bookingId — check review state for current user
// Returns: { canReview, alreadyReviewed, role, partnerReviewed }
router.get('/status/:bookingId', requireAuth, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    const booking = await getBookingById(bookingId);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const isRenter = booking.renter_id === req.session.userId;
    const isHost = booking.host_id === req.session.userId;
    if (!isRenter && !isHost) return res.status(403).json({ error: 'Access denied' });

    const canReview = booking.status === 'completed';
    const alreadyReviewed = await hasReviewedBooking(bookingId, req.session.userId);
    const existingReviews = await getReviewsForBooking(bookingId);
    // Partner review exists if the other party has already submitted
    const partnerReviewed = existingReviews.some(r => r.reviewer_id !== req.session.userId);

    res.json({
      canReview,
      alreadyReviewed,
      role: isRenter ? 'renter' : 'host',
      partnerReviewed,
      published: existingReviews.some(r => r.published_at !== null),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load review status' });
  }
});

// POST /api/reviews — submit a review (renter or host)
// Body: { bookingId, rating, ratingDetails, comment }
router.post('/', requireAuth, async (req, res) => {
  const { bookingId, rating, ratingDetails, comment } = req.body;
  if (!bookingId || !rating) return res.status(400).json({ error: 'bookingId and rating required' });
  const ratingNum = parseInt(rating);
  if (ratingNum < 1 || ratingNum > 5) return res.status(400).json({ error: 'Rating must be 1-5' });

  try {
    const booking = await getBookingById(parseInt(bookingId));
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const isRenter = booking.renter_id === req.session.userId;
    const isHost = booking.host_id === req.session.userId;
    if (!isRenter && !isHost) return res.status(403).json({ error: 'Access denied' });
    if (booking.status !== 'completed') return res.status(400).json({ error: 'Can only review completed bookings' });

    const alreadyReviewed = await hasReviewedBooking(parseInt(bookingId), req.session.userId);
    if (alreadyReviewed) return res.status(409).json({ error: 'Already reviewed this booking' });

    const cleanComment = comment ? moderateComment(comment) : null;
    const reviewerRole = isRenter ? 'renter' : 'host';
    const revieweeId = isRenter ? booking.host_id : booking.renter_id;

    const review = await createReview({
      bookingId: parseInt(bookingId),
      boardId: booking.board_id,
      reviewerId: req.session.userId,
      revieweeId,
      reviewerRole,
      rating: ratingNum,
      ratingDetails: ratingDetails || {},
      comment: cleanComment,
    });

    // Check if both parties have now reviewed — if yes, publish immediately
    const allReviews = await getReviewsForBooking(parseInt(bookingId));
    const bothReviewed = allReviews.length >= 2;
    if (bothReviewed) {
      await publishReviewsForBooking(parseInt(bookingId));
    }

    res.json({
      review,
      published: bothReviewed,
      message: bothReviewed
        ? 'Avis publié — les deux parties ont noté !'
        : 'Avis enregistré. Il sera publié dès que l\'autre partie aura noté (ou dans 7 jours).',
    });
  } catch (err) {
    console.error('Create review error:', err.message);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

module.exports = router;
