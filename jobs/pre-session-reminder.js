// What this job owns: sending T-24h pre-session reminder emails to renters.
// Does NOT own email templates (services/pre-session-reminder-email.js) or DB queries (db/bookings.js).
// Runs every hour via polsia.toml [[crons]]. Idempotency: reminder_sent_at sentinel on bookings.
'use strict';

const { getBookingsForPreSessionReminder, markReminderSent } = require('../db/bookings');
const { sendPreSessionReminderEmail } = require('../services/pre-session-reminder-email');

async function run() {
  const bookings = await getBookingsForPreSessionReminder();

  if (bookings.length === 0) {
    console.log('[pre-session-reminder] No bookings eligible for reminder.');
    return 0;
  }

  console.log(`[pre-session-reminder] Found ${bookings.length} booking(s) to remind.`);
  let sent = 0;

  for (const booking of bookings) {
    // Mark sent BEFORE attempting send — prevents double-dispatch if send is slow/retried
    await markReminderSent(booking.id);
    await sendPreSessionReminderEmail(booking);
    sent++;
  }

  console.log(`[pre-session-reminder] Done — emailed ${sent} renter(s).`);
  return sent;
}

// Direct entrypoint for polsia.toml cron
if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[pre-session-reminder] Fatal error:', err.message);
      process.exit(1);
    });
}

module.exports = { run };
