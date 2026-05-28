// What this module owns: board_blocked_dates table queries.
// Does NOT handle bookings conflicts — see db/bookings.js for that.
// Model: available by default; rows = explicitly blocked days.
const pool = require('./index');

/**
 * Return all blocked dates for a board within a month window.
 * @param {number} boardId
 * @param {string} from  YYYY-MM-DD (inclusive)
 * @param {string} to    YYYY-MM-DD (inclusive)
 * @returns {Promise<string[]>} array of 'YYYY-MM-DD' strings
 */
async function getBlockedDates(boardId, from, to) {
  const result = await pool.query(
    `SELECT blocked_date::text AS blocked_date
     FROM board_blocked_dates
     WHERE board_id = $1
       AND blocked_date BETWEEN $2 AND $3
     ORDER BY blocked_date`,
    [boardId, from, to]
  );
  return result.rows.map(r => r.blocked_date.slice(0, 10));
}

/**
 * Return ALL blocked dates for a board (for full availability checks).
 */
async function getAllBlockedDates(boardId) {
  const result = await pool.query(
    `SELECT blocked_date::text AS blocked_date
     FROM board_blocked_dates
     WHERE board_id = $1
     ORDER BY blocked_date`,
    [boardId]
  );
  return result.rows.map(r => r.blocked_date.slice(0, 10));
}

/**
 * Toggle a single date blocked/unblocked.
 * Returns { blocked: boolean, date: string }
 */
async function toggleBlockedDate(boardId, date) {
  // Try to insert; if conflict, delete instead
  const existing = await pool.query(
    'SELECT id FROM board_blocked_dates WHERE board_id = $1 AND blocked_date = $2',
    [boardId, date]
  );
  if (existing.rows.length > 0) {
    await pool.query(
      'DELETE FROM board_blocked_dates WHERE board_id = $1 AND blocked_date = $2',
      [boardId, date]
    );
    return { blocked: false, date };
  } else {
    await pool.query(
      'INSERT INTO board_blocked_dates (board_id, blocked_date) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [boardId, date]
    );
    return { blocked: true, date };
  }
}

/**
 * Block a range of dates (start inclusive, end exclusive — same convention as bookings).
 * Skips already-blocked dates via ON CONFLICT DO NOTHING.
 */
async function blockDateRange(boardId, startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const dates = [];
  const cur = new Date(start);
  while (cur < end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  if (dates.length === 0) return 0;

  // Build multi-row insert
  const values = dates.map((d, i) => `($1, $${i + 2})`).join(', ');
  await pool.query(
    `INSERT INTO board_blocked_dates (board_id, blocked_date) VALUES ${values} ON CONFLICT DO NOTHING`,
    [boardId, ...dates]
  );
  return dates.length;
}

/**
 * Unblock a range of dates.
 */
async function unblockDateRange(boardId, startDate, endDate) {
  const result = await pool.query(
    `DELETE FROM board_blocked_dates
     WHERE board_id = $1 AND blocked_date >= $2 AND blocked_date < $3`,
    [boardId, startDate, endDate]
  );
  return result.rowCount;
}

/**
 * Check if ALL dates in [startDate, endDate) are free from host blocks.
 */
async function isRangeAvailable(boardId, startDate, endDate) {
  const result = await pool.query(
    `SELECT COUNT(*) AS blocked_count
     FROM board_blocked_dates
     WHERE board_id = $1
       AND blocked_date >= $2
       AND blocked_date < $3`,
    [boardId, startDate, endDate]
  );
  return parseInt(result.rows[0].blocked_count) === 0;
}

// ─── Hourly blocked slots (board_blocked_slots) ─────────────────────────────────

/**
 * Get all blocked hour-slots for a board on a specific date.
 * Returns array of { start_hour, end_hour } objects.
 */
async function getBlockedSlots(boardId, date) {
  const result = await pool.query(
    `SELECT start_hour, end_hour
     FROM board_blocked_slots
     WHERE board_id = $1 AND blocked_date = $2
     ORDER BY start_hour`,
    [boardId, date]
  );
  return result.rows;
}

/**
 * Get all booked hour-ranges for a board on a specific date (excludes stale pending).
 * Returns array of { start_time, end_time } (as 'HH:MM' strings).
 */
async function getBookedSlots(boardId, date) {
  const result = await pool.query(
    `SELECT start_time::text AS start_time, end_time::text AS end_time
     FROM bookings
     WHERE board_id = $1
       AND status NOT IN ('cancelled', 'expired')
       AND NOT (status = 'pending' AND pending_at < NOW() - INTERVAL '30 minutes')
       AND start_date = $2
     ORDER BY start_time`,
    [boardId, date]
  );
  return result.rows.map(r => ({
    start_time: r.start_time?.slice(0, 5),
    end_time: r.end_time?.slice(0, 5)
  }));
}

/**
 * Check if a specific time range is available (no booking + no host block).
 * @param {number} boardId
 * @param {string} date  YYYY-MM-DD
 * @param {number} startHour  0-23
 * @param {number} endHour    0-23
 */
async function isSlotAvailable(boardId, date, startHour, endHour) {
  // Check host blocked slots — any overlapping slot blocks the range
  const blocks = await pool.query(
    `SELECT 1 FROM board_blocked_slots
     WHERE board_id = $1 AND blocked_date = $2
       AND start_hour < $4 AND end_hour > $3
     LIMIT 1`,
    [boardId, date, startHour, endHour]
  );
  if (blocks.rows.length > 0) return false;

  // Check bookings — any overlapping non-stale-pending booking blocks the range.
  // 'cancelled' and 'expired' do not block; stale pending (>30 min) treated as expired
  // at query time in addition to formal cron expiry.
  const booked = await pool.query(
    `SELECT 1 FROM bookings
     WHERE board_id = $1
       AND status NOT IN ('cancelled', 'expired')
       AND NOT (status = 'pending' AND pending_at < NOW() - INTERVAL '30 minutes')
       AND start_date = $2
       AND start_time IS NOT NULL
       AND EXTRACT(HOUR FROM start_time)::int < $4
       AND EXTRACT(HOUR FROM end_time)::int > $3
     LIMIT 1`,
    [boardId, date, startHour, endHour]
  );
  if (booked.rows.length > 0) return false;

  return true;
}

/**
 * Toggle a single hourly slot blocked/unblocked.
 * Returns { blocked: boolean, date, start_hour, end_hour }
 */
async function toggleBlockedSlot(boardId, date, startHour, endHour) {
  const existing = await pool.query(
    'SELECT id FROM board_blocked_slots WHERE board_id = $1 AND blocked_date = $2 AND start_hour = $3 AND end_hour = $4',
    [boardId, date, startHour, endHour]
  );
  if (existing.rows.length > 0) {
    await pool.query(
      'DELETE FROM board_blocked_slots WHERE board_id = $1 AND blocked_date = $2 AND start_hour = $3 AND end_hour = $4',
      [boardId, date, startHour, endHour]
    );
    return { blocked: false, date, start_hour: startHour, end_hour: endHour };
  } else {
    await pool.query(
      `INSERT INTO board_blocked_slots (board_id, blocked_date, start_hour, end_hour)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [boardId, date, startHour, endHour]
    );
    return { blocked: true, date, start_hour: startHour, end_hour: endHour };
  }
}

/**
 * Compute available time slots for a board on a given date.
 * Returns array of { start, end } slots (e.g. [{start:8,end:12}, {start:14,end:18}]).
 * Considers: bookings, host-blocked slots, board operating hours (6-22).
 */
async function getAvailableSlots(boardId, date) {
  const bookings = await getBookedSlots(boardId, date);
  const hostSlots = await getBlockedSlots(boardId, date);

  // Merge all occupied hours into a Set
  const occupied = new Set();
  for (const b of bookings) {
    if (!b.start_time || !b.end_time) continue;
    const s = parseInt(b.start_time.split(':')[0]);
    const e = parseInt(b.end_time.split(':')[0]);
    for (let h = s; h < e; h++) occupied.add(h);
  }
  for (const s of hostSlots) {
    for (let h = s.start_hour; h < s.end_hour; h++) occupied.add(h);
  }

  // Operating hours: 6-22 (open slots between 6:00 and 22:00)
  const slots = [];
  let slotStart = null;
  for (let h = 6; h <= 22; h++) {
    if (!occupied.has(h) && h < 22) {
      if (slotStart === null) slotStart = h;
    } else {
      if (slotStart !== null) {
        slots.push({ start: slotStart, end: h });
        slotStart = null;
      }
    }
  }
  if (slotStart !== null) slots.push({ start: slotStart, end: 22 });

  // Filter out slots shorter than 2h (minimum booking)
  return slots.filter(s => s.end - s.start >= 2);
}

module.exports = {
  getBlockedDates, getAllBlockedDates, toggleBlockedDate, blockDateRange, unblockDateRange, isRangeAvailable,
  getBlockedSlots, getBookedSlots, isSlotAvailable, toggleBlockedSlot, getAvailableSlots
};
