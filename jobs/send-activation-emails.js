const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
// What this job owns: one-shot activation email send to 14 unbooked users.
// Does NOT own the email proxy — delegates to the Polsia email API.
// Run once via: node jobs/send-activation-emails.js

'use strict';

const { Pool } = require('pg');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const CAMPAIGN = 'activation_2026_05';
const TEMPLATE_VERSION = 'v1';
const BASE_URL = 'https://swell.polsia.app';
const PROMO_CODE = 'FIRSTSESSION50';

if (!RESEND_API_KEY) {
  console.error('[activation-emails] RESEND_API_KEY is not set — aborting.');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('[activation-emails] DATABASE_URL is not set — aborting.');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ── helpers ──────────────────────────────────────────────────────────────────

function firstName(full) {
  return (full || 'Surfeur').split(' ')[0].replace(/[^a-zA-ZÀ-ÿ]/g, '');
}

function formatPrice(cents) {
  if (!cents) return null;
  return `${(cents / 100).toFixed(0)}€/h`;
}

function getPhotoUrl(photos) {
  if (!photos || !Array.isArray(photos) || photos.length === 0) return null;
  return photos[0];
}

function maskEmail(email) {
  if (!email) return '***';
  const at = email.indexOf('@');
  if (at <= 3) return email.slice(0, 1) + '***' + email.slice(at);
  return email.slice(0, 3) + '***' + email.slice(at);
}

function buildBoardRow(board) {
  const photo = getPhotoUrl(board.photos);
  const price = formatPrice(board.hourly_rate_cents) || '€??/h';
  const boardTypeLabel = { shortboard: 'Shortboard', midlength: 'Mid-length', longboard: 'Longboard', funboard: 'Funboard' }[board.board_type] || board.board_type || '';
  const boardUrl = `${BASE_URL}/app.html#/board/${board.id}`;

  const photoCell = photo
    ? `<td width="80" style="padding-right:12px"><a href="${boardUrl}"><img src="${photo}" width="80" height="60" style="border-radius:8px;object-fit:cover;display:block" alt="${board.title}"></a></td>`
    : `<td width="80" style="padding-right:12px"><a href="${boardUrl}"><div style="width:80px;height:60px;background:#e8f4f8;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:24px">🏄</div></a></td>`;

  return `<tr>
  ${photoCell}
  <td style="vertical-align:top">
    <a href="${boardUrl}" style="color:#1a1a2e;text-decoration:none;font-weight:600;font-size:14px;line-height:1.3">${board.title}</a>
    <br><span style="color:#666;font-size:12px">${boardTypeLabel} · ${price}</span>
    <br><span style="color:#888;font-size:11px">📍 ${board.location || 'Hossegor'}</span>
  </td>
  <td width="80" style="vertical-align:middle;text-align:right">
    <a href="${boardUrl}" style="background:#0d6efd;color:#fff;text-decoration:none;padding:6px 12px;border-radius:20px;font-size:12px;font-weight:600;white-space:nowrap">Voir</a>
  </td>
</tr>`;
}

function buildHtmlEmail(user, boards) {
  const first = firstName(user.name);
  const boardsHtml = boards.map(buildBoardRow).join('');
  const ctaUrl = `${BASE_URL}/app.html`;
  const referrerCode = user.referral_code || PROMO_CODE;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Swell — Ta première session t'attend</title>
</head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f4f8;padding:30px 10px">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:16px;overflow:hidden;max-width:600px">

      <!-- Header -->
      <tr><td style="background:#0d6efd;padding:28px 32px;text-align:center">
        <span style="font-size:28px;font-weight:800;color:#fff;letter-spacing:-0.5px">Swell</span>
        <span style="font-size:22px;margin-left:4px">🏄</span>
        <br><span style="color:#cde4ff;font-size:14px;font-weight:400;margin-top:4px;display:block">Location de surfboards entre particuliers</span>
      </td></tr>

      <!-- Greeting -->
      <tr><td style="padding:28px 32px 16px">
        <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a2e;line-height:1.3">
          Salut ${first}, ta première session t'attend 🏄
        </h1>
        <p style="margin:0;color:#555;font-size:15px;line-height:1.6">
          Tu t'es inscris sur Swell mais tu n'as pas encore réservé.<br>
          On a des boards au top dispo près de chez toi — et on te donne <strong>50% de réduction</strong> pour te lancer.
        </p>
      </td></tr>

      <!-- Board cards -->
      <tr><td style="padding:0 32px">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          ${boards.length > 0 ? boards.map(b => buildBoardRow(b)).join('') : ''}
        </table>
        ${boards.length === 0 ? `<p style="color:#666;font-size:14px;text-align:center;padding:16px 0">Consulte l'app pour voir la sélection du moment →</p>` : ''}
      </td></tr>

      <!-- CTA -->
      <tr><td style="padding:24px 32px 8px;text-align:center">
        <a href="${ctaUrl}" style="display:inline-block;background:#0d6efd;color:#fff;text-decoration:none;padding:16px 40px;border-radius:30px;font-size:16px;font-weight:700;letter-spacing:0.3px">
          Réserver ma première session →
        </a>
      </td></tr>

      <!-- Promo code block -->
      <tr><td style="padding:16px 32px">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e8f4ff;border-radius:12px">
          <tr><td style="padding:20px 24px;text-align:center">
            <p style="margin:0 0 6px;color:#0d6efd;font-size:13px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase">Code promo exclusif</p>
            <p style="margin:0 0 4px;font-size:28px;font-weight:800;color:#1a1a2e;letter-spacing:2px">${PROMO_CODE}</p>
            <p style="margin:0;color:#555;font-size:13px">50% de réduction sur ta première session</p>
          </td></tr>
        </table>
      </td></tr>

      <!-- Referral -->
      <tr><td style="padding:0 32px 24px">
        <p style="margin:0;background:#fff8e6;border-radius:10px;padding:14px 18px;color:#7a5c00;font-size:13px;line-height:1.5;text-align:center">
          💡 <strong>Et si tu invites un pote ?</strong> Il crédite 10€ sur votre prochain booking tous les deux.<br>
          <a href="${ctaUrl}#/profile" style="color:#0d6efd">Ton lien invite →</a>
        </p>
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#f8f9fa;padding:20px 32px;border-top:1px solid #e9ecef">
        <p style="margin:0 0 6px;color:#aaa;font-size:11px;text-align:center;line-height:1.5">
          Swell · Hossegor, France · <a href="mailto:swell@polsia.app" style="color:#aaa">swell@polsia.app</a>
        </p>
        <p style="margin:0;color:#bbb;font-size:10px;text-align:center">
          Pour ne plus recevoir ces emails : <a href="mailto:swell@polsia.app?subject=unsubscribe" style="color:#bbb">unsubscribe</a>
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function buildTextEmail(user, boards) {
  const first = firstName(user.name);
  const boardLines = boards.slice(0, 3).map(b => {
    const price = formatPrice(b.hourly_rate_cents) || '€??/h';
    return `  - ${b.title} · ${price} · ${b.location || 'Hossegor'}`;
  }).join('\n');

  return `Salut ${first},

Tu t'es inscris sur Swell mais tu n'as pas encore réservé ta première session. On a des boards au top dispo près de chez toi — et on te donne 50% de réduction pour te lancer.

${boardLines.length > 0 ? 'Boards disponibles :\n' + boardLines + '\n\n' : ''}
Code promo : ${PROMO_CODE} — 50% sur ta première session

Réserve maintenant : ${BASE_URL}/app.html

Et si tu invites un pote, vous créditez 10€ tous les deux.

À l'eau,
L'équipe Swell

---
Swell · Hossegor, France
Pour ne plus recevoir ces emails : swell@polsia.app (sujet : unsubscribe)`;
}

// ── core send ─────────────────────────────────────────────────────────────────

async function sendEmail(to, firstName, user, boards) {
  const html = buildHtmlEmail(user, boards);
  const text = buildTextEmail(user, boards);
  const subject = `${firstName}, ta première session à -50% t'attend 🏄`;

  const res = await fetch(`${}/api/proxy/email/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      to,
      subject,
      body: text,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Email proxy returned ${res.status}: ${body}`);
  }
  return res.json();
}

async function logSend(userId, email, version) {
  await pool.query(
    `INSERT INTO email_sends (user_id, email, campaign, template_version)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, campaign) DO NOTHING`,
    [userId, email, CAMPAIGN, version]
  );
}

// ── main ─────────────────────────────────────────────────────────────────────

async function run() {
  const usersResult = await pool.query(`
    SELECT
      u.id,
      u.email,
      u.name,
      u.created_at,
      u.location,
      u.referral_code,
      COUNT(b.id) AS booking_count
    FROM users u
    LEFT JOIN bookings b ON b.renter_id = u.id
    WHERE u.email IS NOT NULL
      AND u.email NOT LIKE '%@polsia.app'
      AND u.email NOT LIKE '%test%@%'
      AND u.name NOT ILIKE '%test%'
      AND u.name NOT ILIKE '%bot%'
      AND NOT EXISTS (
        SELECT 1 FROM email_sends es
        WHERE es.user_id = u.id AND es.campaign = $1
      )
    GROUP BY u.id
    ORDER BY booking_count ASC, u.created_at ASC
    LIMIT 14
  `, [CAMPAIGN]);

  const users = usersResult.rows;
  console.log(`[activation-emails] Found ${users.length} users to email`);

  if (users.length === 0) {
    console.log('[activation-emails] No users to email — nothing to do.');
    return [];
  }

  const boardsResult = await pool.query(`
    SELECT id, title, board_type, hourly_rate_cents, location, photos
    FROM boards
    WHERE is_listed = true
    ORDER BY stripe_onboarding_completed_at DESC NULLS LAST, hourly_rate_cents ASC
    LIMIT 9
  `);
  const boards = boardsResult.rows;

  const results = [];

  for (const user of users) {
    const first = firstName(user.name);
    console.log(`[activation-emails] Sending to ${maskEmail(user.email)} (${user.name})`);

    try {
      await sendEmail(user.email, first, user, boards);
      await logSend(user.id, user.email, TEMPLATE_VERSION);
      console.log(`  ✓ Sent to ${maskEmail(user.email)}`);
      results.push({ user_id: user.id, email_masked: maskEmail(user.email), status: 'sent', boards_count: boards.length });
    } catch (err) {
      console.error(`  ✗ Failed for ${maskEmail(user.email)}: ${err.message}`);
      results.push({ user_id: user.id, email_masked: maskEmail(user.email), status: 'failed', error: err.message, boards_count: boards.length });
    }

    // Brief pause between sends (email proxy rate limit + friendly)
    await new Promise(r => setTimeout(r, 500));
  }

  const sent = results.filter(r => r.status === 'sent').length;
  const failed = results.filter(r => r.status === 'failed').length;
  console.log(`[activation-emails] Done — ${sent} sent, ${failed} failed`);

  return results;
}

if (require.main === module) {
  run()
    .then(results => {
      console.log('\n=== Campaign results ===');
      console.log(results.map(r => `${r.email_masked}\t${r.status}\t${r.boards_count} boards`).join('\n'));
      process.exit(0);
    })
    .catch(err => {
      console.error('[activation-emails] Fatal error:', err.message);
      process.exit(1);
    });
}

module.exports = { run };