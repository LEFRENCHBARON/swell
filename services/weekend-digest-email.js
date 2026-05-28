// What this module owns: weekly "Ce weekend sur Swell" digest email template and send.
// Does NOT own DB queries (db/weekendDigest.js), generic send (services/email.js),
// or user segmentation logic.

'use strict';

const { sendTransactionalEmail } = require('./email');
const { logEmailEvent } = require('../db/weekendDigest');

const APP_URL = process.env.APP_URL || 'https://swell.polsia.app';

/**
 * Build the subject line.
 * If the user has a closest spot, use it: "🏄 Ce weekend à Hossegor"
 * Otherwise fallback to generic.
 */
function buildSubject(spotName) {
  if (spotName) return `🏄 Ce weekend à ${spotName} — 3 boards dispo`;
  return '🏄 Ce weekend sur Swell — 3 boards dispo';
}

/** Format €/h price from cents */
function fmtPrice(cents) {
  if (!cents) return '?';
  return `${(cents / 100).toFixed(0)}€/h`;
}

/** First photo URL from JSONB photos array */
function firstPhoto(photos) {
  try {
    const arr = Array.isArray(photos) ? photos : JSON.parse(photos || '[]');
    return arr.find(p => p && p.trim()) || '';
  } catch {
    return '';
  }
}

/** Board type label in French */
function boardTypeLabel(type) {
  const labels = {
    shortboard: 'Shortboard', longboard: 'Longboard', fish: 'Fish',
    funboard: 'Funboard', malibu: 'Malibu', gun: 'Gun',
    hybrid: 'Hybride', foil: 'Foil', bodyboard: 'Bodyboard',
    sup: 'SUP', other: 'Autre',
  };
  return labels[type] || type || 'Planche';
}

/** Wave type label */
function waveTypeLabel(wt) {
  const labels = { beach_break: 'Beach break', point_break: 'Point break', reef_break: 'Reef', mixed: 'Mixte' };
  return labels[wt] || wt || '';
}

/** Level badge */
function levelLabel(lvl) {
  const l = { beginner: 'Débutant', intermediate: 'Intermédiaire', advanced: 'Expert', all: 'Tous niveaux' };
  return l[lvl] || '';
}

/**
 * Render one board card HTML.
 */
function renderBoardCard(board) {
  const photo = firstPhoto(board.photos);
  const price = fmtPrice(board.hourly_rate_cents);
  const boardLabel = board.title || boardTypeLabel(board.board_type);
  const spotDisplay = board.spot_name || board.location || 'Hossegor';
  const boardUrl = board.spot_slug
    ? `${APP_URL}/spot/${board.spot_slug}?utm_source=email&utm_campaign=weekend-digest`
    : `${APP_URL}/app.html?utm_source=email&utm_campaign=weekend-digest`;

  const photoHtml = photo
    ? `<img src="${photo}" alt="${boardLabel}" width="80" height="72" style="width:80px;height:72px;object-fit:cover;border-radius:8px;display:block;">`
    : `<div style="width:80px;height:72px;background:#cbd5e1;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:20px;">🏄</div>`;

  const verifiedBadge = board.is_verified_host
    ? `<span style="display:inline-block;background:#dcfce7;color:#166534;font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;margin-left:6px;vertical-align:middle;">✓ Hôte vérifié</span>`
    : '';

  return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
<tr>
  <td style="padding:14px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="width:80px;vertical-align:top;">${photoHtml}</td>
      <td style="padding-left:14px;vertical-align:top;">
        <div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:2px;">${boardLabel}${verifiedBadge}</div>
        <div style="font-size:13px;color:#64748b;margin-bottom:8px;">📍 ${spotDisplay} · <strong style="color:#0ea5e9;">${price}</strong></div>
        <a href="${boardUrl}" style="display:inline-block;background:#0ea5e9;color:#fff;text-decoration:none;padding:7px 16px;border-radius:7px;font-size:13px;font-weight:700;">Réserver →</a>
      </td>
    </tr>
    </table>
  </td>
</tr>
</table>`;
}

/**
 * Render one spot teaser card.
 */
function renderSpotCard(spot) {
  const wt = waveTypeLabel(spot.wave_type);
  const lvl = levelLabel(spot.level);
  const spotUrl = spot.slug
    ? `${APP_URL}/spot/${spot.slug}?utm_source=email&utm_campaign=weekend-digest`
    : `${APP_URL}/map?utm_source=email&utm_campaign=weekend-digest`;

  return `
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;">
<tr>
  <td style="padding:14px 16px;">
    <div style="font-size:14px;font-weight:700;color:#0369a1;">🌊 ${spot.name}</div>
    <div style="font-size:12px;color:#64748b;margin:3px 0 8px;">${[wt, lvl].filter(Boolean).join(' · ')}</div>
    <a href="${spotUrl}" style="font-size:12px;color:#0ea5e9;text-decoration:none;font-weight:600;">Voir les boards dispo →</a>
  </td>
</tr>
</table>`;
}

/**
 * Build full HTML email body.
 *
 * @param {object} opts
 * @param {string} opts.firstName
 * @param {string} opts.spotName  - closest spot or null
 * @param {Array}  opts.boards    - up to 3 board rows
 * @param {Array}  opts.spots     - up to 2 spot rows
 * @param {string} opts.satLabel  - e.g. "samedi 31 mai"
 * @param {string} opts.sunLabel  - e.g. "dimanche 1 juin"
 * @param {boolean} opts.usedFirstSession50
 * @param {string} opts.referralCode
 */
function buildDigestHtml({ firstName, spotName, boards, spots, satLabel, sunLabel, usedFirstSession50, referralCode }) {
  const greeting = firstName ? `Salut ${firstName} 🤙` : 'Salut 🤙';
  const introSpot = spotName ? `<strong>${spotName}</strong>` : 'Hossegor';

  const boardCardsHtml = boards.length > 0
    ? boards.map(renderBoardCard).join('')
    : `<p style="color:#64748b;font-size:14px;text-align:center;padding:16px 0;">Aucune planche filtrée pour ce weekend — <a href="${APP_URL}/app.html" style="color:#0ea5e9;">vois tout le catalogue →</a></p>`;

  const spotCardsHtml = spots.length > 0
    ? spots.map(renderSpotCard).join('')
    : '';

  // CTA block: if user hasn't used FIRSTSESSION50 → show promo; else → referral push
  const ctaBlockHtml = usedFirstSession50
    ? `
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;background:linear-gradient(135deg,#0f172a,#1e3a5f);border-radius:12px;overflow:hidden;">
<tr><td style="padding:20px 24px;text-align:center;color:#fff;">
  <div style="font-size:20px;margin-bottom:8px;">🤙</div>
  <div style="font-size:16px;font-weight:700;margin-bottom:6px;">Invite un pote — +10€ chacun</div>
  <div style="font-size:13px;color:#94a3b8;margin-bottom:14px;">Partage ton lien de parrainage. Quand ton pote réserve, vous gagnez tous les deux 10€ de crédit.</div>
  <a href="${APP_URL}/app.html?referral=${referralCode || ''}&utm_source=email&utm_campaign=weekend-digest-referral" style="display:inline-block;background:#38bdf8;color:#0f172a;text-decoration:none;padding:10px 24px;border-radius:8px;font-weight:700;font-size:14px;">Inviter un ami →</a>
</td></tr>
</table>`
    : `
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;background:#fffbeb;border:2px solid #fde68a;border-radius:12px;overflow:hidden;">
<tr><td style="padding:20px 24px;text-align:center;">
  <div style="font-size:12px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🎉 Première session</div>
  <div style="font-size:22px;font-weight:800;color:#0f172a;margin-bottom:4px;">-50% avec <span style="color:#0ea5e9;">FIRSTSESSION50</span></div>
  <div style="font-size:13px;color:#64748b;margin-bottom:14px;">Cap 15€ · réservations horaires uniquement</div>
  <a href="${APP_URL}/app.html?promo=FIRSTSESSION50&utm_source=email&utm_campaign=weekend-digest-promo" style="display:inline-block;background:#0ea5e9;color:#fff;text-decoration:none;padding:10px 24px;border-radius:8px;font-weight:700;font-size:14px;">Utiliser mon code →</a>
</td></tr>
</table>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ce weekend sur Swell</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Helvetica Neue',Arial,sans-serif;color:#1f2937;">
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 16px 0;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">

  <!-- HEADER -->
  <tr><td style="background:linear-gradient(135deg,#0369a1 0%,#0ea5e9 100%);padding:28px 28px 24px;border-radius:16px 16px 0 0;text-align:center;">
    <div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-0.5px;">SWELL</div>
    <div style="color:rgba(255,255,255,0.8);font-size:13px;margin-top:2px;">Location de planches à l'heure · Hossegor</div>
  </td></tr>

  <!-- BODY -->
  <tr><td style="background:#fff;padding:28px 28px 8px;">
    <p style="margin:0 0 6px;font-size:18px;font-weight:700;color:#0f172a;">${greeting}</p>
    <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;">
      Les vagues arrivent ce weekend à ${introSpot}.<br>
      Voici 3 planches encore dispo pour ${satLabel} et ${sunLabel} :
    </p>

    <!-- BOARD CARDS -->
    ${boardCardsHtml}

    <!-- SPOTS SECTION -->
    ${spotCardsHtml ? `
    <p style="margin:20px 0 12px;font-size:15px;font-weight:700;color:#0f172a;">🗺️ Spots à checker ce weekend</p>
    ${spotCardsHtml}` : ''}

  </td></tr>

  <!-- CTA BLOCK -->
  <tr><td style="background:#fff;padding:0 28px 20px;">
    ${ctaBlockHtml}
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#f8fafc;padding:20px 28px;border-top:1px solid #e2e8f0;border-radius:0 0 16px 16px;text-align:center;">
    <p style="margin:0 0 6px;font-size:12px;color:#94a3b8;">
      Swell — Location de boards entre surfers · <a href="${APP_URL}" style="color:#0ea5e9;text-decoration:none;">swell.polsia.app</a>
    </p>
    <p style="margin:0;font-size:12px;color:#94a3b8;">
      <a href="${APP_URL}/unsubscribe" style="color:#94a3b8;text-decoration:underline;">Se désabonner</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

/**
 * Send the weekend digest to a single user.
 * Non-fatal — errors are logged but do not propagate.
 *
 * @param {object} user  - row from getUsersForDigest()
 * @param {Array}  boards
 * @param {Array}  spots
 * @param {string} satLabel - e.g. "samedi 31 mai"
 * @param {string} sunLabel - e.g. "dimanche 1 juin"
 */
async function sendWeekendDigest(user, boards, spots, satLabel, sunLabel) {
  if (!user.email) return { status: 'skip', reason: 'no_email' };

  const firstName = user.name ? user.name.split(' ')[0] : null;
  // Pick a representative spot for the subject: first spot card, or first board's spot
  const topSpot = (spots && spots[0]?.name) || (boards && boards[0]?.spot_name) || null;

  const subject = buildSubject(topSpot);

  try {
    const html = buildDigestHtml({
      firstName,
      spotName: topSpot,
      boards: boards || [],
      spots: spots || [],
      satLabel,
      sunLabel,
      usedFirstSession50: user.used_firstsession50 || false,
      referralCode: user.referral_code || '',
    });

    const result = await sendTransactionalEmail({
      to: user.email,
      subject,
      htmlBody: html,
      tag: 'weekend-digest',
      replyTo: 'sebastien@swell.fr',
    });

    const messageId = result?.MessageID || result?.message_id || null;
    console.log(`[weekend-digest] Sent to ${user.email} (msg ${messageId})`);

    // Log the send event so we can correlate future opens/clicks
    if (messageId) {
      logEmailEvent(user.id, user.email, 'weekend-digest', 'send', messageId)
        .catch(e => console.error('[weekend-digest] email_events insert error:', e.message));
    }

    return { status: 'sent', messageId };
  } catch (err) {
    console.error(`[weekend-digest] Failed for ${user.email}:`, err.message);
    return { status: 'error', error: err.message };
  }
}

module.exports = { buildSubject, buildDigestHtml, sendWeekendDigest };
