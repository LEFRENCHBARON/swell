// What this job owns: sending T+24h post-session emails to renters.
// Does NOT own email templates (services/post-session-email.js) or DB queries (db/bookings.js).
// Runs every hour via polsia.toml [[crons]]. Idempotency: post_session_email_sent_at sentinel on bookings.

'use strict';

const { getBookingsForPostSessionEmail, markPostSessionEmailSent } = require('../db/bookings');
const { sendPostSessionEmail } = require('../services/post-session-email');

async function run() {
  const bookings = await getBookingsForPostSessionEmail();

  if (bookings.length === 0) {
    console.log('[post-session-email] No bookings eligible for post-session email.');
    return 0;
  }

  console.log(`[post-session-email] Found ${bookings.length} booking(s) to email.`);
  let sent = 0;

  for (const booking of bookings) {
    // Mark sent BEFORE attempting send — prevents double-dispatch if send is slow/retried
    await markPostSessionEmailSent(booking.id);
    await sendPostSessionEmail(booking);
    sent++;
  }

  console.log(`[post-session-email] Done — emailed ${sent} renter(s).`);
  return sent;
}

// Direct entrypoint for polsia.toml cron
if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[post-session-email] Fatal error:', err.message);
      process.exit(1);
    });
}

module.exports = { run };
