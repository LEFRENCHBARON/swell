// What this job owns: transitioning stale pending bookings to 'expired' status.
// Does NOT delete bookings — audit trail is preserved. Runs every 15 minutes via polsia.toml cron.
// Can also be triggered manually via POST /api/bookings/expire-stale (internal, CRON_SECRET auth).

'use strict';

const { expireStalePendingBookings } = require('../db/bookings');

async function run() {
  const rows = await expireStalePendingBookings();
  const count = rows.length;
  if (count > 0) {
    console.log(`[expire-stale-bookings] Expired ${count} stale pending booking(s):`, rows.map(r => r.id).join(', '));
  } else {
    console.log('[expire-stale-bookings] No stale pending bookings found.');
  }
  return count;
}

// Run directly (cron entrypoint)
if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[expire-stale-bookings] Fatal error:', err.message);
      process.exit(1);
    });
}

module.exports = { expireStalePendingBookings: run };
