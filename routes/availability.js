// What this module owns: host calendar management (block/unblock dates).
// Does NOT own booking creation or payment — see routes/bookings.js.
const express = require('express');
const router = express.Router();
const { getBlockedDates, toggleBlockedDate, blockDateRange, unblockDateRange, getBlockedSlots, getAvailableSlots, toggleBlockedSlot } = require('../db/availability');
const { getBoardById } = require('../db/boards');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  next();
}

// Verify caller owns the board
async function requireBoardOwner(req, res, next) {
  const boardId = parseInt(req.params.boardId);
  if (!boardId) return res.status(400).json({ error: 'Invalid boardId' });
  try {
    const board = await getBoardById(boardId);
    if (!board) return res.status(404).json({ error: 'Board not found' });
    if (board.host_id !== req.session.userId) return res.status(403).json({ error: 'Not your board' });
    req.board = board;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

// GET /api/availability/:boardId?from=YYYY-MM-DD&to=YYYY-MM-DD
// Public — renters and hosts both read this.
router.get('/:boardId', async (req, res) => {
  try {
    const boardId = parseInt(req.params.boardId);
    if (!boardId) return res.status(400).json({ error: 'Invalid boardId' });

    // Default: today → today + 62 days (2 months)
    const today = new Date();
    const defaultFrom = today.toISOString().slice(0, 10);
    const defaultTo = new Date(today.getTime() + 62 * 86400000).toISOString().slice(0, 10);

    const from = req.query.from || defaultFrom;
    const to = req.query.to || defaultTo;

    const blockedDates = await getBlockedDates(boardId, from, to);
    res.json({ blockedDates, from, to });
  } catch (err) {
    console.error('[Availability] GET error:', err.message);
    res.status(500).json({ error: 'Failed to load availability' });
  }
});

// POST /api/availability/:boardId/toggle — host toggles a single day
// Body: { date: 'YYYY-MM-DD' }
router.post('/:boardId/toggle', requireAuth, requireBoardOwner, async (req, res) => {
  const { date } = req.body;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
  }

  // Don't allow blocking dates in the past
  const today = new Date().toISOString().slice(0, 10);
  if (date < today) return res.status(400).json({ error: 'Cannot block past dates' });

  try {
    const result = await toggleBlockedDate(req.board.id, date);
    res.json(result);
  } catch (err) {
    console.error('[Availability] toggle error:', err.message);
    res.status(500).json({ error: 'Failed to toggle date' });
  }
});

// POST /api/availability/:boardId/block-range — host blocks a date range
// Body: { startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' }  (endDate exclusive)
router.post('/:boardId/block-range', requireAuth, requireBoardOwner, async (req, res) => {
  const { startDate, endDate } = req.body;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required' });

  const today = new Date().toISOString().slice(0, 10);
  if (startDate < today) return res.status(400).json({ error: 'Cannot block past dates' });
  if (endDate <= startDate) return res.status(400).json({ error: 'endDate must be after startDate' });

  try {
    const count = await blockDateRange(req.board.id, startDate, endDate);
    res.json({ blocked: count, startDate, endDate });
  } catch (err) {
    console.error('[Availability] block-range error:', err.message);
    res.status(500).json({ error: 'Failed to block dates' });
  }
});

// POST /api/availability/:boardId/unblock-range — host unblocks a date range
router.post('/:boardId/unblock-range', requireAuth, requireBoardOwner, async (req, res) => {
  const { startDate, endDate } = req.body;
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required' });

  try {
    const count = await unblockDateRange(req.board.id, startDate, endDate);
    res.json({ unblocked: count, startDate, endDate });
  } catch (err) {
    console.error('[Availability] unblock-range error:', err.message);
    res.status(500).json({ error: 'Failed to unblock dates' });
  }
});

// GET /api/availability/:boardId/slots?date=YYYY-MM-DD
// Returns available time slots for a given date (hourly model).
router.get('/:boardId/slots', async (req, res) => {
  try {
    const boardId = parseInt(req.params.boardId);
    const { date } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });
    }
    const slots = await getAvailableSlots(boardId, date);
    res.json({ date, slots });
  } catch (err) {
    console.error('[Availability] slots error:', err.message);
    res.status(500).json({ error: 'Failed to load slots' });
  }
});

// POST /api/availability/:boardId/toggle-slot — host toggles a single hour slot
// Body: { date: 'YYYY-MM-DD', startHour: 8, endHour: 12 }
router.post('/:boardId/toggle-slot', requireAuth, requireBoardOwner, async (req, res) => {
  const { date, startHour, endHour } = req.body;
  if (!date || startHour === undefined || endHour === undefined) {
    return res.status(400).json({ error: 'date, startHour, endHour required' });
  }
  if (startHour < 6 || endHour > 22 || startHour >= endHour) {
    return res.status(400).json({ error: 'Slots must be 06:00–22:00, start < end' });
  }
  const today = new Date().toISOString().slice(0, 10);
  if (date < today) return res.status(400).json({ error: 'Cannot block past dates' });

  try {
    const result = await toggleBlockedSlot(req.board.id, date, startHour, endHour);
    res.json(result);
  } catch (err) {
    console.error('[Availability] toggle-slot error:', err.message);
    res.status(500).json({ error: 'Failed to toggle slot' });
  }
});

// GET /api/availability/:boardId/slots-by-date?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns slots for each date in range — for the calendar slot view.
router.get('/:boardId/slots-by-date', async (req, res) => {
  try {
    const boardId = parseInt(req.params.boardId);
    const today = new Date();
    const defaultFrom = today.toISOString().slice(0, 10);
    const defaultTo = new Date(today.getTime() + 62 * 86400000).toISOString().slice(0, 10);
    const from = req.query.from || defaultFrom;
    const to = req.query.to || defaultTo;

    const result = {};
    const cur = new Date(from);
    const end = new Date(to);
    while (cur <= end) {
      const dateStr = cur.toISOString().slice(0, 10);
      const slots = await getAvailableSlots(boardId, dateStr);
      result[dateStr] = slots;
      cur.setDate(cur.getDate() + 1);
    }
    res.json({ from, to, slotsByDate: result });
  } catch (err) {
    console.error('[Availability] slots-by-date error:', err.message);
    res.status(500).json({ error: 'Failed to load slots by date' });
  }
});

module.exports = router;
