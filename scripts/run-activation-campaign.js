/**
 * Activation email campaign runner (2026-05-28)
 * Called via: node scripts/run-activation-campaign.js
 * Or triggered via: curl -X POST https://swell.polsia.app/api/admin/send-activation-emails
 *   -H "Authorization: Bearer $ADMIN_SECRET"
 * Env vars required: DATABASE_URL, RESEND_API_KEY, ADMIN_SECRET
 */
const { Pool } = require('pg');
const fetch = require('node-fetch');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const CAMPAIGN = 'activation_2026_05';
const PROMO_CODE = 'FIRSTSESSION50';
const BASE_URL = process.env.BASE_URL || 'https://swell.polsia.app';

async function getActivationTargets(client) {
  const r = await client.query(`
    SELECT u.id, u.email, u.name, u.created_at, u.location,
           COUNT(bk.id)::INT AS booking_count
    FROM users u
    LEFT JOIN bookings bk ON bk.renter_id = u.id
    WHERE u.email IS NOT NULL AND u.email != '' AND u.id != 9
      AND NOT EXISTS (
        SELECT 1 FROM email_sends es
        WHERE es.user_id = u.id AND es.campaign = $1
      )
    GROUP BY u.id
    ORDER BY booking_count ASC, u.created_at ASC
    LIMIT 14
  `, [CAMPAIGN]);
  return r.rows;
}

async function getBoardsNearLocation(client, location, limit = 3) {
  const regionFilter = location && location.trim()
    ? `%${location.trim()}%`
    : '%Hossegor%';
  const r = await client.query(`
    SELECT b.id, b.title, b.board_type, b.hourly_rate_cents, b.photos, b.location,
           u.stripe_charges_enabled AS verified_host
    FROM boards b
    JOIN users u ON u.id = b.host_id
    WHERE b.is_available = true AND b.is_listed = true
      AND (b.location ILIKE $1 OR b.region ILIKE $1 OR b.location ILIKE '%Hossegor%')
    ORDER BY u.stripe_charges_enabled DESC NULLS LAST, b.hourly_rate_cents ASC NULLS LAST
    LIMIT $2
  `, [regionFilter, limit]);
  return r.rows;
}

async function logEmail(client, userId, email, version = 'v1') {
  await client.query(`
    INSERT INTO email_sends (user_id, email, campaign, template_version)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, campaign) DO NOTHING
  `, [userId, email, CAMPAIGN, version]);
}

async function sendEmail({ to, subject, htmlBody, textBody }) {
  const res = await fetch('https://polsia.com/api/proxy/email/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({ to, subject, body: htmlBody, html: htmlBody, text: textBody, tag: CAMPAIGN, replyTo: 'sebastien@swell.fr' }),
  });
  if (!res.ok) throw new Error(`Email failed (${res.status}): ${await res.text()}`);
  return res.json();
}

function buildHtml(user, boards) {
  const firstName = user.name ? user.name.split(' ')[0] : 'Surfer';
  const boardRows = boards.length > 0
    ? boards.map(b => `<tr><td style="padding:4px 0;font-size:13px;color:#444;">• ${b.title || b.board_type || 'Planche'} — €${b.hourly_rate_cents ? (b.hourly_rate_cents / 100).toFixed(0) : '?'}/h</td></tr>`).join('')
    : '<tr><td style="padding:4px 0;font-size:13px;color:#64748b;">Plusieurs boards dispo a Hossegor et Biarritz — vois-les sur l app.</td></tr>';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${firstName}, ta premiere session a -50% t'attend 🏄</title>
</head>
<body style="margin:0;padding:0;background:#f0f9fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9fb;padding:32px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
<tr><td style="background:linear-gradient(135deg,#0a6e8c,#00B4D8);padding:32px 32px 28px;text-align:center;border-radius:16px 16px 0 0;">
  <div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-0.5px;">SWELL</div>
  <div style="color:rgba(255,255,255,0.8);font-size:14px;margin-top:4px;">Location de planches a l'heure · Hossegor</div>
</td></tr>
<tr><td style="background:#ffffff;padding:32px 32px 24px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
  <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0a1628;line-height:1.3;">Salut ${firstName}, ta premiere session t'attend 🏄</h1>
  <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;">Tu t'es inscrit sur Swell mais tu n'as pas encore reserve. On a des boards top dispo pres de chez toi — et on te fait -50% pour te lancer.</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
  ${boardRows}
  </table>
</td></tr>
<tr><td style="background:#fffbeb;border-left:1px solid #fde68a;border-right:1px solid #fde68a;padding:20px 32px;text-align:center;">
  <div style="font-size:12px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🎉 Code promo</div>
  <table cellpadding="0" cellspacing="0" style="display:inline-block;margin-bottom:8px;">
  <tr><td style="background:#0a1628;border-radius:8px;padding:12px 24px;">
    <span style="font-family:monospace;font-size:20px;font-weight:800;color:#fde68a;letter-spacing:3px;">FIRSTSESSION50</span>
  </td></tr>
  </table>
  <div style="font-size:14px;color:#92400e;font-weight:600;">50% de reduction sur ta premiere session</div>
  <div style="font-size:12px;color:#b45309;margin-top:4px;">Cap 15€ · Valable 60 jours</div>
</td></tr>
<tr><td style="background:#ffffff;padding:24px 32px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;text-align:center;">
  <table cellpadding="0" cellspacing="0" style="display:inline-block;">
  <tr><td style="background:#0a6e8c;border-radius:10px;">
    <a href="${BASE_URL}/app.html?utm_source=email&utm_campaign=${CAMPAIGN}" style="color:#fff;text-decoration:none;font-size:16px;font-weight:700;display:block;padding:14px 32px;">
      Reserver ma premiere session →
    </a>
  </td></tr>
  </table>
</td></tr>
<tr><td style="background:#f0f9fb;padding:16px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;text-align:center;">
  <p style="margin:0;font-size:13px;color:#64748b;">Invite un pote → <strong style="color:#0a6e8c;">+10€ de credit</strong> sur ton compte Swell.</p>
</td></tr>
<tr><td style="padding:20px 16px;text-align:center;">
  <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.6;">Pour ne plus recevoir ces emails : <a href="mailto:swell@polsia.app?subject=unsubscribe" style="color:#94a3b8;">swell@polsia.app</a><br>Swell · Hossegor, France</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildText(user) {
  const firstName = user.name ? user.name.split(' ')[0] : 'Surfer';
  return `Salut ${firstName},

Tu t'es inscrit sur Swell mais tu n'as pas encore reserve ta premiere session. On a des boards top dispo pres de chez toi — et on te fait 50% de reduction pour te lancer.

Code promo : FIRSTSESSION50 (50% sur ta premiere session, cap 15€)

Reserve maintenant : ${BASE_URL}/app.html

Et si tu invites un pote, tu gagnes 10€ de credit.

A l'eau,
L'equipe Swell`;
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  return local.slice(0, 3) + '***@' + domain;
}

async function main() {
  if (!process.env.DATABASE_URL || !process.env.RESEND_API_KEY) {
    console.error('Missing required env vars: DATABASE_URL, RESEND_API_KEY');
    process.exit(1);
  }

  const client = await pool.connect();
  const results = [];

  try {
    const users = await getActivationTargets(client);
    if (users.length === 0) {
      console.log('No users eligible for activation campaign.');
      return;
    }
    console.log(`Found ${users.length} eligible users.`);

    for (const user of users) {
      console.log(`Processing: ${maskEmail(user.email)} (${user.name || 'no name'})`);
      const boards = await getBoardsNearLocation(client, user.location, 3);

      const firstName = user.name ? user.name.split(' ')[0] : 'Surfer';
      const htmlBody = buildHtml(user, boards);
      const textBody = buildText(user);
      const subject = `${firstName}, ta premiere session a -50% t'attend 🏄`;

      try {
        await sendEmail({ to: user.email, subject, htmlBody, textBody });
        await logEmail(client, user.id, user.email, 'v1');
        results.push({ userId: user.id, email: maskEmail(user.email), boardsShown: boards.length, status: 'sent' });
        console.log(`  ✓ Sent (${boards.length} boards shown)`);
      } catch (err) {
        console.error(`  ✗ Failed: ${err.message}`);
        results.push({ userId: user.id, email: maskEmail(user.email), status: 'failed', error: err.message });
      }

      // Brief pause between sends to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    }

    const sent = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'failed').length;
    console.log(`\nCampaign complete: ${sent} sent, ${failed} failed`);
    console.log(JSON.stringify({ sent, failed, total: users.length, results }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});