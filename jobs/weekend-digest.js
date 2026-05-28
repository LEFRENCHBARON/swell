// What this job owns: weekly weekend digest email dispatch (jeudi 18h Europe/Paris).
// Does NOT own email templates (services/weekend-digest-email.js) or DB queries
// (db/weekendDigest.js). Idempotency: weekend_digest_sends table (user_id, week_number).
//
// Scheduled via polsia.toml [[crons]]: "0 17 * * 4" (UTC = 18h Paris).
// Can also be triggered manually via POST /api/admin/send-weekend-digest.

'use strict';

const {
  isoWeekKey,
  getUsersForDigest,
  getWeekendBoards,
  getWeekendSpots,
  markDigestSent,
} = require('../db/weekendDigest');
const { sendWeekendDigest } = require('../services/weekend-digest-email');

/**
 * Returns the next Saturday and Sunday dates from a reference date.
 * If today is Thu/Fri, that means this coming weekend.
 */
function nextWeekend(from = new Date()) {
  const d = new Date(from);
  const dow = d.getDay(); // 0=Sun … 6=Sat
  // Days until next Saturday
  const daysToSat = (6 - dow + 7) % 7 || 7;
  const sat = new Date(d);
  sat.setDate(d.getDate() + daysToSat);
  sat.setHours(0, 0, 0, 0);
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  return { sat, sun };
}

/** French date label: "samedi 31 mai" */
function frLabel(date) {
  return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
}

/** YYYY-MM-DD for SQL */
function sqlDate(date) {
  return date.toISOString().slice(0, 10);
}

async function run() {
  const now = new Date();
  const weekKey = isoWeekKey(now);
  const { sat, sun } = nextWeekend(now);
  const satDate = sqlDate(sat);
  const sunDate = sqlDate(sun);
  const satLabel = frLabel(sat);
  const sunLabel = frLabel(sun);

  console.log(`[weekend-digest] week=${weekKey} sat=${satDate} sun=${sunDate}`);

  // Fetch shared data once — same boards/spots for all recipients this run
  const [users, boards, spots] = await Promise.all([
    getUsersForDigest(weekKey),
    getWeekendBoards(satDate, sunDate, 3),
    getWeekendSpots(satDate, sunDate, 2),
  ]);

  console.log(`[weekend-digest] ${users.length} users, ${boards.length} boards, ${spots.length} spots`);

  if (users.length === 0) {
    console.log('[weekend-digest] No users to email this week. Exiting.');
    return { sent: 0, skipped: 0, errors: 0 };
  }

  let sent = 0, skipped = 0, errors = 0;

  for (const user of users) {
    // Mark BEFORE sending — prevents double-dispatch if send is slow/retried
    await markDigestSent(user.id, weekKey);

    const result = await sendWeekendDigest(user, boards, spots, satLabel, sunLabel);

    if (result.status === 'sent') sent++;
    else if (result.status === 'skip') skipped++;
    else errors++;

    // Small back-off between sends to avoid proxy rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`[weekend-digest] Done — sent=${sent} skipped=${skipped} errors=${errors}`);
  return { sent, skipped, errors };
}

// Direct entrypoint when called by polsia.toml cron
if (require.main === module) {
  run()
    .then(stats => {
      console.log('[weekend-digest] Stats:', JSON.stringify(stats));
      process.exit(0);
    })
    .catch(err => {
      console.error('[weekend-digest] Fatal error:', err.message);
      process.exit(1);
    });
}

module.exports = { run, nextWeekend };
