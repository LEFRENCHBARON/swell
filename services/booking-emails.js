// What this module owns: booking confirmation email templates and orchestration.
// Does NOT own generic email sending (services/email.js) or DB queries (db/bookings.js, db/emailLogs.js).
const { sendTransactionalEmail } = require('./email');
const { logEmailSent, logEmailError } = require('../db/emailLogs');

const APP_URL = process.env.APP_URL || 'https://swell.polsia.app';

// Payout = rental amount × 88% (after 12% Swell commission).
// Host receives this in the next daily Stripe payout cycle.
function calcPayoutCents(rentalCents) {
  return Math.round((rentalCents || 0) * 0.88);
}

// Format cents as "X,XX €"
function fmtEur(cents) {
  return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
}

// Format date/time for display: "Samedi 14 juin 2026, 09h00 – 13h00"
function fmtSlot(booking) {
  const opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const date = new Date(booking.start_date).toLocaleDateString('fr-FR', opts);
  if (booking.start_time && booking.end_time) {
    const sh = String(booking.start_time).padStart(5, '0').replace(':', 'h').slice(0, 4);
    const eh = String(booking.end_time).padStart(5, '0').replace(':', 'h').slice(0, 4);
    return `${date}, ${sh}00 – ${eh}00`;
  }
  if (booking.end_date && booking.end_date !== booking.start_date) {
    const endDate = new Date(booking.end_date).toLocaleDateString('fr-FR', opts);
    return `${date} → ${endDate}`;
  }
  return date;
}

// WhatsApp deep link pre-filled with intro message.
// phone must be international format without '+' (e.g. "33612345678").
function whatsappLink(phone, message) {
  if (!phone) return null;
  const clean = phone.replace(/[^0-9]/g, '');
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${clean}?text=${encoded}`;
}

// Board thumbnail: first element of JSONB photos array.
function boardThumbnail(photos) {
  try {
    const arr = typeof photos === 'string' ? JSON.parse(photos) : photos;
    if (Array.isArray(arr) && arr.length > 0) {
      const first = arr[0];
      if (typeof first === 'string') return first;
      if (first && first.url) return first.url;
    }
  } catch (_) {
    // ignore malformed photos
  }
  return null;
}

// ─── RENTER EMAIL ────────────────────────────────────────────────────────────

function buildRenterEmailHtml(data) {
  const {
    booking, boardTitle, boardThumbnailUrl, slot, depositCents,
    rentalCents, serviceFeeCents, damageWaiverCents, totalCents,
    hostName, hostAvatarUrl, hostPhone,
    whatsappToHost, bookingUrl, cancelPolicyUrl
  } = data;

  const depositInfo = depositCents > 0
    ? `<tr><td style="color:#f97316;padding:4px 0">🔒 Caution Swell Shield</td><td style="text-align:right;color:#f97316">${fmtEur(depositCents)}</td></tr>`
    : '';

  const waiverRow = damageWaiverCents > 0
    ? `<tr><td style="padding:4px 0">🛡️ Protection dommages</td><td style="text-align:right">${fmtEur(damageWaiverCents)}</td></tr>`
    : '';

  const hostPhoneRow = hostPhone
    ? `<p style="margin:4px 0;color:#374151">📱 <a href="tel:${hostPhone}" style="color:#0ea5e9;text-decoration:none">${hostPhone}</a></p>`
    : '';

  const waBtn = whatsappToHost
    ? `<a href="${whatsappToHost}" style="display:inline-block;margin-top:10px;padding:10px 20px;background:#25D366;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">💬 Contacter le host sur WhatsApp</a>`
    : '';

  const thumbnailBlock = boardThumbnailUrl
    ? `<img src="${boardThumbnailUrl}" alt="${boardTitle}" style="width:100%;max-height:220px;object-fit:cover;border-radius:12px;margin-bottom:16px" />`
    : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Helvetica Neue',Arial,sans-serif;color:#1f2937">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
  <tr><td style="padding:32px 24px 0">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:28px">
      <div style="font-size:28px;margin-bottom:8px">🤙</div>
      <h1 style="margin:0;font-size:22px;font-weight:700;color:#0f172a">C'est confirmé !</h1>
      <p style="margin:6px 0 0;color:#64748b;font-size:15px">Ta session est réservée — voici tout ce qu'il te faut.</p>
    </div>

    <!-- Board card -->
    <div style="background:#fff;border-radius:16px;padding:20px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.06)">
      ${thumbnailBlock}
      <h2 style="margin:0 0 8px;font-size:18px;color:#0f172a">${boardTitle}</h2>
      <p style="margin:0;font-size:15px;color:#475569">📅 ${slot}</p>
    </div>

    <!-- Prix détaillé -->
    <div style="background:#fff;border-radius:16px;padding:20px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.06)">
      <h3 style="margin:0 0 14px;font-size:15px;font-weight:600;color:#0f172a">Récapitulatif du paiement</h3>
      <table width="100%" style="font-size:14px;color:#374151">
        <tr><td style="padding:4px 0">Location</td><td style="text-align:right">${fmtEur(rentalCents)}</td></tr>
        ${waiverRow}
        <tr><td style="padding:4px 0;color:#64748b">Frais de service</td><td style="text-align:right;color:#64748b">${fmtEur(serviceFeeCents)}</td></tr>
        <tr><td colspan="2" style="border-top:1px solid #e2e8f0;padding-top:8px;margin-top:8px"></td></tr>
        <tr><td style="font-weight:700;padding:4px 0">Total payé</td><td style="text-align:right;font-weight:700">${fmtEur(totalCents)}</td></tr>
        ${depositInfo}
      </table>
      ${depositCents > 0 ? `<p style="margin:12px 0 0;font-size:12px;color:#94a3b8">La caution de ${fmtEur(depositCents)} a été prélevée sur ta carte. Elle sera remboursée intégralement dans les 48h suivant la fin de ta session si aucun dommage n'est signalé. <a href="${APP_URL}/app.html#swell-shield" style="color:#0ea5e9">En savoir plus</a>.</p>` : ''}
    </div>

    <!-- Host contact — revealed post-paiement -->
    <div style="background:#fff;border-radius:16px;padding:20px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.06)">
      <h3 style="margin:0 0 14px;font-size:15px;font-weight:600;color:#0f172a">Ton host</h3>
      <div style="display:flex;align-items:center;gap:14px">
        ${hostAvatarUrl ? `<img src="${hostAvatarUrl}" alt="${hostName}" style="width:52px;height:52px;border-radius:50%;object-fit:cover;flex-shrink:0" />` : `<div style="width:52px;height:52px;border-radius:50%;background:#e0f2fe;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🏄</div>`}
        <div>
          <p style="margin:0;font-weight:600;font-size:16px;color:#0f172a">${hostName}</p>
          ${hostPhoneRow}
        </div>
      </div>
      ${waBtn}
    </div>

    <!-- Règles -->
    <div style="background:#fef9ec;border:1px solid #fde68a;border-radius:12px;padding:16px;margin-bottom:20px">
      <h3 style="margin:0 0 10px;font-size:14px;font-weight:600;color:#92400e">Rappel des règles ⚠️</h3>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:#78350f;line-height:1.7">
        <li>Retourne le board dans l'état où tu l'as reçu — propre, sans sable.</li>
        <li>Signale <strong>immédiatement</strong> tout dommage au host, avant de rendre le board.</li>
        <li>Prends des photos de l'état du board à la prise en charge et au retour.</li>
        <li>Sois à l'heure au point de rendez-vous.</li>
      </ul>
    </div>

    <!-- CTA -->
    <div style="text-align:center;margin-bottom:28px">
      <a href="${bookingUrl}" style="display:inline-block;padding:14px 32px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px">Voir ma réservation</a>
      <p style="margin:14px 0 0;font-size:13px;color:#94a3b8">
        <a href="${cancelPolicyUrl}" style="color:#94a3b8">Politique d'annulation</a>
        &nbsp;·&nbsp;
        <a href="mailto:support@swell.fr" style="color:#94a3b8">Contacter le support</a>
      </p>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:16px 0 32px;border-top:1px solid #e2e8f0;margin-top:8px">
      <p style="margin:0;font-size:12px;color:#94a3b8">Swell — Location de boards entre surfers · <a href="${APP_URL}" style="color:#0ea5e9;text-decoration:none">swell.polsia.app</a></p>
    </div>

  </td></tr>
</table>
</body>
</html>`;
}

// ─── HOST EMAIL ──────────────────────────────────────────────────────────────

function buildHostEmailHtml(data) {
  const {
    booking, boardTitle, slot, depositCents,
    rentalCents, payoutCents,
    renterName, renterAvatarUrl, renterPhone,
    whatsappToRenter, bookingUrl
  } = data;

  const renterPhoneRow = renterPhone
    ? `<p style="margin:4px 0;color:#374151">📱 <a href="tel:${renterPhone}" style="color:#0ea5e9;text-decoration:none">${renterPhone}</a></p>`
    : '';

  const waBtn = whatsappToRenter
    ? `<a href="${whatsappToRenter}" style="display:inline-block;margin-top:10px;padding:10px 20px;background:#25D366;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">💬 Contacter le rider sur WhatsApp</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Helvetica Neue',Arial,sans-serif;color:#1f2937">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
  <tr><td style="padding:32px 24px 0">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:28px">
      <div style="font-size:28px;margin-bottom:8px">🤙</div>
      <h1 style="margin:0;font-size:22px;font-weight:700;color:#0f172a">Nouvelle réservation !</h1>
      <p style="margin:6px 0 0;color:#64748b;font-size:15px">Le paiement est confirmé — voici les infos du rider.</p>
    </div>

    <!-- Booking summary -->
    <div style="background:#fff;border-radius:16px;padding:20px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.06)">
      <h2 style="margin:0 0 8px;font-size:18px;color:#0f172a">${boardTitle}</h2>
      <p style="margin:0;font-size:15px;color:#475569">📅 ${slot}</p>
    </div>

    <!-- Renter contact -->
    <div style="background:#fff;border-radius:16px;padding:20px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.06)">
      <h3 style="margin:0 0 14px;font-size:15px;font-weight:600;color:#0f172a">Le rider</h3>
      <div style="display:flex;align-items:center;gap:14px">
        ${renterAvatarUrl ? `<img src="${renterAvatarUrl}" alt="${renterName}" style="width:52px;height:52px;border-radius:50%;object-fit:cover;flex-shrink:0" />` : `<div style="width:52px;height:52px;border-radius:50%;background:#e0f2fe;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🏄</div>`}
        <div>
          <p style="margin:0;font-weight:600;font-size:16px;color:#0f172a">${renterName}</p>
          ${renterPhoneRow}
        </div>
      </div>
      ${waBtn}
    </div>

    <!-- Paiement / payout -->
    <div style="background:#fff;border-radius:16px;padding:20px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.06)">
      <h3 style="margin:0 0 14px;font-size:15px;font-weight:600;color:#0f172a">Paiement confirmé 💰</h3>
      <table width="100%" style="font-size:14px;color:#374151">
        <tr><td style="padding:4px 0">Montant location</td><td style="text-align:right">${fmtEur(rentalCents)}</td></tr>
        <tr><td colspan="2" style="border-top:1px solid #e2e8f0;padding-top:8px"></td></tr>
        <tr><td style="font-weight:700;padding:4px 0;color:#16a34a">Ton virement estimé (J+1)</td><td style="text-align:right;font-weight:700;color:#16a34a">${fmtEur(payoutCents)}</td></tr>
      </table>
      <p style="margin:10px 0 0;font-size:12px;color:#94a3b8">Le virement arrive sur ton compte Stripe Connect dans le prochain cycle de payout (généralement J+1 ouvré). Commission Swell : 12%.</p>
    </div>

    <!-- Checklist remise -->
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin-bottom:20px">
      <h3 style="margin:0 0 10px;font-size:14px;font-weight:600;color:#166534">Checklist avant remise 📋</h3>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:#15803d;line-height:1.8">
        <li>Vérifier l'état du board (dings, délamination) — photo avant remise.</li>
        <li>Préparer leash + wax (inclus ?).</li>
        <li>Confirmer le point et l'heure de remise avec le rider via WhatsApp.</li>
        <li>Rappeler les règles : pas d'eau de javel, retour propre.</li>
      </ul>
    </div>

    <!-- Caution reminder -->
    ${depositCents > 0 ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:14px;margin-bottom:20px">
      <p style="margin:0;font-size:13px;color:#9a3412">🔒 <strong>Caution ${fmtEur(depositCents)} active</strong> — le montant a été prélevé sur la carte du rider. En cas de dommage constaté au retour, déclenche le processus de réclamation depuis ta résa avant la libération automatique (48h).</p>
    </div>` : ''}

    <!-- CTA -->
    <div style="text-align:center;margin-bottom:28px">
      <a href="${bookingUrl}" style="display:inline-block;padding:14px 32px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px">Voir la réservation</a>
    </div>

    <!-- Footer -->
    <div style="text-align:center;padding:16px 0 32px;border-top:1px solid #e2e8f0">
      <p style="margin:0;font-size:12px;color:#94a3b8">Swell — Location de boards entre surfers · <a href="${APP_URL}" style="color:#0ea5e9;text-decoration:none">swell.polsia.app</a></p>
    </div>

  </td></tr>
</table>
</body>
</html>`;
}

// ─── ORCHESTRATION ───────────────────────────────────────────────────────────

/**
 * Send confirmation emails to both renter and host after successful payment.
 * booking: result of getBookingConfirmationData(bookingId)
 * amounts: { rentalCents, damageWaiverCents, serviceFeeCents, totalCents, depositCents }
 * Both sends are non-fatal — errors are logged but do not propagate.
 */
async function sendBookingConfirmationEmails(booking, amounts) {
  const {
    id: bookingId,
    board_title, board_photos,
    spot_name, pickup_instructions,
    renter_name, renter_email, renter_phone, renter_avatar,
    host_name, host_email, host_phone, host_avatar,
    start_date, end_date, start_time, end_time, duration_hours
  } = booking;

  const { rentalCents = 0, damageWaiverCents = 0, serviceFeeCents = 0, totalCents = 0, depositCents = 0 } = amounts;
  const payoutCents = calcPayoutCents(rentalCents);
  const slot = fmtSlot(booking);
  const boardThumbnailUrl = boardThumbnail(board_photos);
  const bookingUrl = `${APP_URL}/app.html#booking-${bookingId}`;
  const cancelPolicyUrl = `${APP_URL}/app.html#politique-annulation`;

  // WhatsApp intro messages
  const renterIntroMsg = `Salut ${host_name} ! Je viens de réserver ton board "${board_title}" pour ${slot}. À bientôt sur l'eau ! 🤙`;
  const hostIntroMsg   = `Salut ${renter_name} ! J'ai bien vu ta résa pour "${board_title}" le ${slot}. On se retrouve à ${pickup_instructions || spot_name || 'l\'endroit convenu'}. 🤙`;

  const whatsappToHost   = whatsappLink(host_phone,   renterIntroMsg);
  const whatsappToRenter = whatsappLink(renter_phone, hostIntroMsg);

  // ── Send renter email ──
  const renterSubject = `C'est confirmé — ta session sur ${board_title} est réservée`;
  try {
    const renterHtml = buildRenterEmailHtml({
      booking,
      boardTitle: board_title,
      boardThumbnailUrl,
      slot,
      depositCents,
      rentalCents,
      serviceFeeCents,
      damageWaiverCents,
      totalCents,
      hostName: host_name,
      hostAvatarUrl: host_avatar,
      hostPhone: host_phone,
      whatsappToHost,
      bookingUrl,
      cancelPolicyUrl
    });
    await sendTransactionalEmail({
      to: renter_email,
      subject: renterSubject,
      htmlBody: renterHtml,
      tag: 'booking-confirmation-renter',
      replyTo: host_email || 'sebastien@swell.fr'
    });
    await logEmailSent({ bookingId, recipientType: 'renter', email: renter_email, subject: renterSubject, tag: 'booking-confirmation-renter' });
  } catch (err) {
    console.error(`[BookingEmails] Renter email failed for booking ${bookingId}:`, err.message);
    await logEmailError({ bookingId, recipientType: 'renter', email: renter_email, subject: renterSubject, tag: 'booking-confirmation-renter', errorMessage: err.message }).catch(() => {});
  }

  // ── Send host email ──
  const hostSubject = `Nouvelle résa — ${renter_name} a réservé ${board_title} pour ${slot}`;
  try {
    const hostHtml = buildHostEmailHtml({
      booking,
      boardTitle: board_title,
      slot,
      depositCents,
      rentalCents,
      payoutCents,
      renterName: renter_name,
      renterAvatarUrl: renter_avatar,
      renterPhone: renter_phone,
      whatsappToRenter,
      bookingUrl
    });
    await sendTransactionalEmail({
      to: host_email,
      subject: hostSubject,
      htmlBody: hostHtml,
      tag: 'booking-confirmation-host',
      replyTo: renter_email || 'sebastien@swell.fr'
    });
    await logEmailSent({ bookingId, recipientType: 'host', email: host_email, subject: hostSubject, tag: 'booking-confirmation-host' });
  } catch (err) {
    console.error(`[BookingEmails] Host email failed for booking ${bookingId}:`, err.message);
    await logEmailError({ bookingId, recipientType: 'host', email: host_email, subject: hostSubject, tag: 'booking-confirmation-host', errorMessage: err.message }).catch(() => {});
  }
}

module.exports = { sendBookingConfirmationEmails };
