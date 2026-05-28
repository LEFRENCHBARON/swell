// What this module owns: email_logs table queries — recording and querying email send events.
// Does NOT own sending logic, templates, or SMTP/proxy config.
const pool = require('./index');

async function logEmailSent({ bookingId, recipientType, email, subject, tag }) {
  const result = await pool.query(`
    INSERT INTO email_logs (booking_id, recipient_type, email, subject, tag, status, sent_at)
    VALUES ($1, $2, $3, $4, $5, 'sent', NOW())
    RETURNING id
  `, [bookingId || null, recipientType, email, subject, tag || null]);
  return result.rows[0];
}

async function logEmailError({ bookingId, recipientType, email, subject, tag, errorMessage }) {
  const result = await pool.query(`
    INSERT INTO email_logs (booking_id, recipient_type, email, subject, tag, status, error_message, sent_at)
    VALUES ($1, $2, $3, $4, $5, 'error', $6, NOW())
    RETURNING id
  `, [bookingId || null, recipientType, email, subject, tag || null, errorMessage]);
  return result.rows[0];
}

// Returns all email log entries for a booking — used for admin/funnel debugging.
async function getEmailLogsByBooking(bookingId) {
  const result = await pool.query(`
    SELECT * FROM email_logs WHERE booking_id = $1 ORDER BY sent_at
  `, [bookingId]);
  return result.rows;
}

module.exports = { logEmailSent, logEmailError, getEmailLogsByBooking };
