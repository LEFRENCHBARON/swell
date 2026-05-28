// What this module owns: T-24h pre-session reminder email template and send orchestration.
// Does NOT own booking queries (db/bookings.js), generic send (services/email.js), or post-session emails.
'use strict';

const { sendTransactionalEmail } = require('./email');
const { logEmailSent, logEmailError } = require('../db/emailLogs');

const APP_URL = process.env.APP_URL || 'https://swell.polsia.app';

// Board thumbnail: first element of JSONB photos array.
function boardThumbnail(photos) {
  try {
    const arr = typeof photos === 'string' ? JSON.parse(photos) : photos;
    if (Array.isArray(arr) && arr.length > 0) {
      const first = arr[0];
      if (typeof first === 'string') return first;
      if (first && first.url) return first.url;
    }
  } catch (_) { /* ignore malformed */ }
  return null;
}

// Format a session slot in French: "Samedi 14 juin 2026, 09h00 – 13h00"
function fmtSlot(booking) {
  const opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const date = new Date(booking.start_date).toLocaleDateString('fr-FR', opts);
  if (booking.start_time && booking.end_time) {
    const sh = String(booking.start_time).padStart(5, '0').replace(':', 'h').slice(0, 4);
    const eh = String(booking.end_time).padStart(5, '0').replace(':', 'h').slice(0, 4);
    return `${date}, ${sh}00 – ${eh}00`;
  }
  return date;
}

// WhatsApp deep-link with pre-filled message.
function whatsappLink(phone, message) {
  if (!phone) return null;
  const clean = phone.replace(/[^0-9]/g, '');
  return `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
}

// Google Maps link from lat/lng (or text query as fallback).
function mapsLink(lat, lng, name) {
  if (lat && lng) return `https://www.google.com/maps?q=${lat},${lng}`;
  return `https://www.google.com/maps/search/${encodeURIComponent(name || 'Hossegor')}`;
}

// Build the HTML body of the pre-session reminder email.
function buildReminderHtml({ booking }) {
  const {
    id: bookingId,
    renter_name,
    board_title, board_photos,
    board_location, pickup_instructions,
    spot_name, lat, lng, parking_notes,
    host_name, host_phone, host_avatar,
    deposit_status, deposit_amount_cents,
    damage_waiver_enabled,
  } = booking;

  const firstName = renter_name ? renter_name.split(' ')[0] : 'Rider';
  const slot = fmtSlot(booking);
  const thumbnailUrl = boardThumbnail(board_photos);

  // Spot section
  const displaySpot = spot_name || board_location || 'Hossegor';
  const mapUrl = mapsLink(lat, lng, displaySpot);
  const parkingLine = parking_notes
    ? `<p style="margin:6px 0 0;font-size:13px;color:#475569">🅿️ ${parking_notes}</p>`
    : '';

  // Host contact
  const hostWaMsg = `Salut ${host_name}, c'est ${firstName} pour la session de demain sur ${board_title} 🤙`;
  const waUrl = whatsappLink(host_phone, hostWaMsg);
  const hostPhoneLine = host_phone
    ? `<p style="margin:4px 0;font-size:13px;color:#374151">📱 <a href="tel:${host_phone}" style="color:#0ea5e9;text-decoration:none">${host_phone}</a></p>`
    : '';
  const waBtn = waUrl
    ? `<a href="${waUrl}" style="display:inline-block;margin-top:10px;padding:10px 20px;background:#25D366;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">💬 Écrire à l'hôte sur WhatsApp</a>`
    : '';

  // Swell Shield block (only if deposit held/active)
  const shieldActive = deposit_status && deposit_status !== 'none' && deposit_amount_cents > 0;
  const depositEur = shieldActive ? `${(deposit_amount_cents / 100).toFixed(0)} €` : '';
  const shieldBlock = shieldActive ? `
    <!-- Swell Shield -->
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:16px;margin-bottom:20px">
      <h3 style="margin:0 0 8px;font-size:14px;font-weight:700;color:#c2410c">🔒 Swell Shield — Caution ${depositEur}</h3>
      <p style="margin:0;font-size:13px;color:#9a3412;line-height:1.6">
        Une caution de <strong>${depositEur}</strong> a été prélevée sur ta carte. Elle sera remboursée intégralement dans les <strong>48h après le retour du board</strong> si aucun dommage n'est signalé. Plus d'infos : <a href="${APP_URL}/app.html#swell-shield" style="color:#c2410c;text-decoration:underline">comment fonctionne Swell Shield</a>.
      </p>
    </div>` : '';

  // Thumbnail block
  const thumbBlock = thumbnailUrl
    ? `<img src="${thumbnailUrl}" alt="${board_title}" style="width:100%;max-height:200px;object-fit:cover;border-radius:12px;margin-bottom:16px" />`
    : '';

  const cancelUrl = `${APP_URL}/app.html#politique-annulation`;

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Helvetica Neue',Arial,sans-serif;color:#1f2937">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto">
  <tr><td style="padding:32px 24px 0">

    <!-- Header -->
    <div style="text-align:center;margin-bottom:28px">
      <div style="font-size:36px;margin-bottom:8px">🌊</div>
      <h1 style="margin:0;font-size:22px;font-weight:700;color:#0f172a">Demain ta session sur ${board_title}</h1>
      <p style="margin:8px 0 0;color:#64748b;font-size:15px">Salut ${firstName} ! Tout ce qu'il te faut pour demain.</p>
    </div>

    <!-- Board card + slot -->
    <div style="background:#fff;border-radius:16px;padding:20px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.06)">
      ${thumbBlock}
      <h2 style="margin:0 0 8px;font-size:18px;font-weight:700;color:#0f172a">${board_title}</h2>
      <p style="margin:0;font-size:15px;color:#475569">📅 ${slot}</p>
    </div>

    <!-- Spot + Maps -->
    <div style="background:#fff;border-radius:16px;padding:20px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.06)">
      <h3 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#0f172a">📍 Le spot</h3>
      <p style="margin:0;font-size:15px;font-weight:600;color:#0f172a">${displaySpot}</p>
      ${pickup_instructions ? `<p style="margin:6px 0 0;font-size:13px;color:#475569">🤝 Point de rendez-vous : ${pickup_instructions}</p>` : ''}
      ${parkingLine}
      <a href="${mapUrl}" style="display:inline-block;margin-top:12px;padding:9px 18px;background:#0ea5e9;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:13px">🗺️ Ouvrir dans Google Maps</a>
    </div>

    <!-- Host contact -->
    <div style="background:#fff;border-radius:16px;padding:20px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.06)">
      <h3 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#0f172a">🤙 Ton hôte</h3>
      <div style="display:flex;align-items:center;gap:14px">
        ${host_avatar ? `<img src="${host_avatar}" alt="${host_name}" style="width:52px;height:52px;border-radius:50%;object-fit:cover;flex-shrink:0" />` : `<div style="width:52px;height:52px;border-radius:50%;background:#e0f2fe;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🏄</div>`}
        <div>
          <p style="margin:0;font-weight:600;font-size:16px;color:#0f172a">${host_name}</p>
          ${hostPhoneLine}
        </div>
      </div>
      ${waBtn}
    </div>

    <!-- Checklist arrivée -->
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin-bottom:20px">
      <h3 style="margin:0 0 10px;font-size:14px;font-weight:700;color:#166534">✅ Checklist arrivée</h3>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:#15803d;line-height:1.9">
        <li><strong>Pièce d'identité originale</strong> — le host peut te la demander.</li>
        <li><strong>Leash</strong> — vérifie qu'il est fourni, sinon prends le tien.</li>
        <li><strong>Wax</strong> — prévu par le host ou à apporter selon l'accord.</li>
        <li><strong>Point de rendez-vous</strong> — confirme avec le host via WhatsApp si besoin.</li>
        <li><strong>Ponctualité ±10 min</strong> — préviens si tu es en retard.</li>
      </ul>
    </div>

    ${shieldBlock}

    <!-- CTA secondaire : annulation -->
    <div style="text-align:center;margin-bottom:28px">
      <p style="margin:0 0 10px;font-size:14px;color:#64748b">Besoin d'annuler ?</p>
      <a href="${cancelUrl}" style="display:inline-block;padding:10px 22px;background:#f1f5f9;color:#475569;text-decoration:none;border-radius:8px;font-weight:600;font-size:13px;border:1px solid #e2e8f0">Voir la politique d'annulation →</a>
    </div>

    <!-- REPEAT15 promo footer reminder -->
    <div style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);border-radius:16px;padding:20px;margin-bottom:20px;color:#fff;text-align:center">
      <p style="margin:0 0 8px;font-size:13px;color:#94a3b8">Après ta session, utilise ton code pour la prochaine :</p>
      <div style="background:rgba(255,255,255,0.1);border:2px dashed rgba(255,255,255,0.3);border-radius:10px;padding:10px 20px;display:inline-block">
        <span style="font-size:20px;font-weight:800;letter-spacing:2px;color:#38bdf8">REPEAT15</span>
      </div>
      <p style="margin:8px 0 0;font-size:12px;color:#64748b">-15% · réservations horaires · 1 usage</p>
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
 * Send the T-24h pre-session reminder email to a renter.
 * booking: row from getBookingsForPreSessionReminder()
 * Non-fatal — errors are logged but do not propagate.
 */
async function sendPreSessionReminderEmail(booking) {
  const { id: bookingId, board_title, renter_email, renter_name } = booking;
  if (!renter_email) return;

  const subject = `Demain ta session sur ${board_title || 'ta planche'} — tout ce qu'il faut savoir`;
  try {
    const html = buildReminderHtml({ booking });
    await sendTransactionalEmail({
      to: renter_email,
      subject,
      htmlBody: html,
      tag: 'pre-session-reminder',
      replyTo: 'sebastien@swell.fr',
    });
    await logEmailSent({ bookingId, recipientType: 'renter', email: renter_email, subject, tag: 'pre-session-reminder' });
    console.log(`[pre-session-reminder] Sent to ${renter_email} for booking ${bookingId}`);
  } catch (err) {
    console.error(`[pre-session-reminder] Failed for booking ${bookingId}:`, err.message);
    await logEmailError({ bookingId, recipientType: 'renter', email: renter_email, subject, tag: 'pre-session-reminder', errorMessage: err.message }).catch(() => {});
  }
}

module.exports = { sendPreSessionReminderEmail };
