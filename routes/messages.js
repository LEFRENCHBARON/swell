// What this module owns: messaging API — conversations list, message history,
//   send message, mark-read, unread badge count.
// Does NOT own booking status updates, auth session management, or profile data.
const express = require('express');
const router = express.Router();
const { getBookingById } = require('../db/bookings');
const {
  getConversationsForUser,
  getMessagesForBooking,
  createMessage,
  markMessagesRead,
  getTotalUnreadCount
} = require('../db/messages');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  next();
}

// Verify the caller is a party (host or renter) to the given booking.
// Attaches booking to req.booking on success.
async function requireBookingAccess(req, res, next) {
  const bookingId = parseInt(req.params.bookingId, 10);
  if (isNaN(bookingId)) return res.status(400).json({ error: 'Invalid booking ID' });

  try {
    const booking = await getBookingById(bookingId);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const userId = req.session.userId;
    if (booking.renter_id !== userId && booking.host_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    req.booking = booking;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify booking access' });
  }
}

// GET /api/messages/conversations — all conversations for current user
router.get('/conversations', requireAuth, async (req, res) => {
  try {
    const conversations = await getConversationsForUser(req.session.userId);
    res.json({ conversations });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

// GET /api/messages/unread — total unread badge count for nav
router.get('/unread', requireAuth, async (req, res) => {
  try {
    const count = await getTotalUnreadCount(req.session.userId);
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// GET /api/messages/:bookingId — fetch messages for a booking
router.get('/:bookingId', requireAuth, requireBookingAccess, async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  || '100', 10), 200);
  const offset = Math.max(parseInt(req.query.offset || '0',   10), 0);
  try {
    const messages = await getMessagesForBooking(req.booking.id, limit, offset);
    res.json({ messages, booking: req.booking });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// Basic PII patterns to block — prevents phone numbers and email addresses in messages.
// Not exhaustive, but catches the obvious cases that push coordination off-platform.
const PII_PATTERNS = [
  /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i,          // email addresses
  /\b(?:\+?\d[\s\-.]?){8,14}\d\b/,             // phone numbers (8–15 digits)
];

function containsPII(text) {
  return PII_PATTERNS.some(re => re.test(text));
}

// POST /api/messages/:bookingId — send a message
router.post('/:bookingId', requireAuth, requireBookingAccess, async (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Message content is required' });
  }
  if (content.trim().length > 500) {
    return res.status(400).json({ error: 'Message too long (max 500 characters)' });
  }
  // Block phone numbers and emails — keep coordination in-platform
  if (containsPII(content.trim())) {
    return res.status(400).json({ error: 'Les messages ne doivent pas contenir de numéro de téléphone ou d\'email. Utilisez la messagerie Swell pour coordonner.' });
  }

  try {
    const message = await createMessage({
      bookingId: req.booking.id,
      senderId: req.session.userId,
      content
    });
    res.status(201).json({ message });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// POST /api/messages/:bookingId/read — mark messages in this conversation as read
router.post('/:bookingId/read', requireAuth, requireBookingAccess, async (req, res) => {
  try {
    const updated = await markMessagesRead(req.booking.id, req.session.userId);
    res.json({ marked: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

module.exports = router;
