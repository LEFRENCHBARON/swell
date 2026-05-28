// What this module owns: post-session (T+24h) email template and send orchestration.
// Does NOT own booking queries (db/bookings.js), generic send (services/email.js), or review storage.
const { sendTransactionalEmail } = require('./email');
const { logEmailSent, logEmailError } = require('../db/emailLogs');

const APP_URL = process.env.APP_URL || 'https://swell.polsia.app';

// Inline star emoji — links to /review?booking={id}&rating={n}
function starLink(bookingId, n, filled) {
  const emoji = filled ? '⭐' : '☆';
  return `<a href="${APP_URL}/review?booking=${bookingId}&rating=${n}" style="font-size:28px;text-decoration:none;margin:0 4px">${emoji}</a>`;
}

function buildStarRating(bookingId) {
  // Pre-build 5 links: tap one to open the review page pre-filled with that rating
  return [1, 2, 3, 4, 5].map(n => starLink(bookingId, n, true)).join('');
}

// Build the post-session HTML email for the renter.
function buildPostSessionEmailHtml({ booking, boardTitle, spotName, promoExpiry }) {
  const { id: bookingId, renter_name } = booking;
  const firstName = renter_name ? renter_name.split(' ')[0] : 'Rider';
  const placeStr = spotName || booking.board_location || 'Hossegor';
  const reviewUrl = `${APP_URL}/review?booking=${bookingId}&rating=5`;
  const appUrl = `${APP_URL}/app.html`;
  // Format expiry date in French (DD/MM/YYYY)
  const expiryDate = promoExpiry.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Helvetica Neue',Arial,sans-serif;color:#1f2937">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
  <tr><td style="padding:32px 24px 0">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:28px">
      <div style="font-size:36px;margin-bottom:8px">🏄</div>
      <h1 style="margin:0;font-size:22px;font-weight:700;color:#0f172a">Ta session est terminée — comment c'était ?</h1>
      <p style="margin:8px 0 0;color:#64748b;font-size:15px">Salut ${firstName} ! Tu viens de rider <strong>${boardTitle}</strong> à ${placeStr}. J'espère que ça déchirait 🤙</p>
    </div>

    <!-- Star rating widget -->
    <div style="background:#fff;border-radius:16px;padding:28px 20px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.06);text-align:center">
      <p style="margin:0 0 14px;font-size:16px;font-weight:600;color:#0f172a">Note ta session (clique sur une étoile)</p>
      <div style="font-size:28px;line-height:1.4">
        ${buildStarRating(bookingId)}
      </div>
      <p style="margin:16px 0 0;font-size:14px;color:#64748b">Tu peux aussi laisser un commentaire sur la page suivante.</p>
      <a href="${reviewUrl}" style="display:inline-block;margin-top:18px;padding:12px 28px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px">Laisser un avis complet</a>
    </div>

    <!-- Repeat booking offer -->
    <div style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);border-radius:16px;padding:24px 20px;margin-bottom:20px;color:#fff;text-align:center">
      <div style="font-size:28px;margin-bottom:10px">🎁</div>
      <h2 style="margin:0 0 8px;font-size:18px;font-weight:700">-15% sur ta prochaine session</h2>
      <p style="margin:0 0 16px;font-size:14px;color:#94a3b8">Pour te remercier d'avoir utilisé Swell, voici un code réservé aux habitués.</p>
      <div style="background:rgba(255,255,255,0.1);border:2px dashed rgba(255,255,255,0.3);border-radius:10px;padding:14px 20px;display:inline-block;margin-bottom:16px">
        <span style="font-size:24px;font-weight:800;letter-spacing:3px;color:#38bdf8">REPEAT15</span>
      </div>
      <p style="margin:0 0 18px;font-size:13px;color:#94a3b8">Valable jusqu'au ${expiryDate} · 1 usage · réservations horaires uniquement</p>
      <a href="${appUrl}" style="display:inline-block;padding:12px 28px;background:#38bdf8;color:#0f172a;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px">Trouve ta prochaine planche →</a>
    </div>

    <!-- WhatsApp support -->
    <div style="text-align:center;margin-bottom:28px">
      <p style="margin:0 0 10px;font-size:14px;color:#64748b">Une question ? On est dispo.</p>
      <a href="https://wa.me/33XXXXXXXXX?text=Salut%20Swell%20!" style="display:inline-block;padding:10px 22px;background:#25D366;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">💬 Nous contacter sur WhatsApp</a>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:16px 0 32px;border-top:1px solid #e2e8f0">
      <p style="margin:0 0 6px;font-size:12px;color:#94a3b8">Swell — Location de boards entre surfers · <a href="${APP_URL}" style="color:#0ea5e9;text-decoration:none">swell.polsia.app</a></p>
      <p style="margin:0;font-size:12px;color:#94a3b8"><a href="${APP_URL}/unsubscribe?email={{email}}" style="color:#94a3b8;text-decoration:underline">Se désabonner</a></p>
    </div>

  </td></tr>
</table>
</body>
</html>`;
}

/**
 * Send the post-session T+24h email to a renter.
 * booking: row from getBookingsForPostSessionEmail()
 * Non-fatal — errors are logged but do not propagate.
 */
async function sendPostSessionEmail(booking) {
  const { id: bookingId, board_title, renter_email, renter_name, spot_name, board_location } = booking;
  if (!renter_email) return;

  // promoExpiry: 30 days from now (rolling — per-email issue date approximation)
  const promoExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const subject = `Ta session est terminée — comment c'était ?`;
  try {
    const html = buildPostSessionEmailHtml({
      booking,
      boardTitle: board_title || 'ta planche',
      spotName: spot_name || board_location,
      promoExpiry,
    });
    await sendTransactionalEmail({
      to: renter_email,
      subject,
      htmlBody: html,
      tag: 'post-session-review',
      replyTo: 'sebastien@swell.fr',
    });
    await logEmailSent({ bookingId, recipientType: 'renter', email: renter_email, subject, tag: 'post-session-review' });
    console.log(`[post-session-email] Sent to ${renter_email} for booking ${bookingId}`);
  } catch (err) {
    console.error(`[post-session-email] Failed for booking ${bookingId}:`, err.message);
    await logEmailError({ bookingId, recipientType: 'renter', email: renter_email, subject, tag: 'post-session-review', errorMessage: err.message }).catch(() => {});
  }
}

module.exports = { sendPostSessionEmail };
