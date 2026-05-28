// Cron job: cancels expired deposit PaymentIntents (pre-auth holds that have passed their 48h window).
// Declared in polsia.toml. Secured by CRON_SECRET header on /api/deposits/cron.

const pool = require('../db/index');


async function run() {
  const CRON_SECRET = process.env.CRON_SECRET;
  if (!CRON_SECRET) {
    console.error('[release-expired-deposits] CRON_SECRET not set — exiting');
    return;
  }

  const result = await pool.query(`
    SELECT bk.id AS booking_id, bk.deposit_session_id, bk.deposit_amount_cents,
           b.title AS board_title, u.name AS renter_name, u.email AS renter_email
    FROM bookings bk
    JOIN boards b ON b.id = bk.board_id
    JOIN users u ON u.id = bk.renter_id
    WHERE bk.deposit_status = 'held'
      AND bk.deposit_refund_at IS NOT NULL
      AND bk.deposit_refund_at <= NOW()
  `);

  const expired = result.rows;
  console.log(`[release-expired-deposits] ${expired.length} expired deposit(s) to release`);

  let released = 0;
  let errors = 0;

  for (const booking of expired) {
    if (!booking.deposit_session_id) {
      await pool.query(
        `UPDATE bookings SET deposit_status = 'released', updated_at = NOW() WHERE id = $1`,
        [booking.booking_id]
      );
      released++;
      continue;
    }

    try {
      await stripe.paymentIntents.cancel(booking.deposit_session_id);

      await pool.query(
        `UPDATE bookings SET deposit_status = 'released', updated_at = NOW() WHERE id = $1`,
        [booking.booking_id]
      );

      released++;
      console.log(`[release-expired-deposits] Released booking ${booking.booking_id} (PI: ${booking.deposit_session_id})`);
    } catch (err) {
      console.error(`[release-expired-deposits] Error releasing booking ${booking.booking_id}:`, err.message);
      errors++;
    }
  }

  console.log(`[release-expired-deposits] Done — ${released} released, ${errors} errors`);
  return { released, errors };
}

run().catch(err => {
  console.error('[release-expired-deposits] Fatal:', err.message);
  process.exit(1);
});