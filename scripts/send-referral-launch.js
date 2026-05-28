// One-shot script: send referral launch email to all existing users.
// Run: DATABASE_URL=... RESEND_API_KEY=... node scripts/send-referral-launch.js
// Does NOT own recurring email or subscription management.
'use strict';
const { Pool } = require('pg');
const fetch = require('node-fetch');

const APP_URL = 'https://swell.polsia.app';
const DB_URL = process.env.DATABASE_URL;
const API_KEY = process.env.RESEND_API_KEY;

if (!DB_URL || !API_KEY) {
  console.error('Missing DATABASE_URL or RESEND_API_KEY');
  process.exit(1);
}

const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

async function run() {
  const { rows: users } = await pool.query(
    `SELECT id, name, email, referral_code FROM users
     WHERE email IS NOT NULL AND email != '' AND id != 9
     ORDER BY created_at ASC`
  );
  console.log(`Found ${users.length} users`);

  const results = [];
  for (const user of users) {
    if (!user.referral_code) { results.push({ email: user.email, status: 'skip-no-code' }); continue; }
    const referralUrl = `${APP_URL}/?ref=${user.referral_code}`;
    const firstName = user.name ? user.name.split(' ')[0] : 'Surfeur';
    try {
      const res = await fetch('https://polsia.com/api/proxy/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
          to: user.email,
          subject: 'Ton code Swell est prêt — €10 pour toi, €10 pour ton pote',
          html: buildHtml(firstName, user.referral_code, referralUrl),
          text: buildText(firstName, user.referral_code, referralUrl),
          tag: 'referral-launch',
          replyTo: 'sebastien@swell.fr',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      results.push({ email: user.email, status: 'sent' });
      console.log(`✓ Sent to ${user.email}`);
    } catch (err) {
      results.push({ email: user.email, status: 'failed', error: err.message });
      console.error(`✗ Failed ${user.email}: ${err.message}`);
    }
  }

  const sent = results.filter(r => r.status === 'sent').length;
  const failed = results.filter(r => r.status === 'failed').length;
  console.log(`\nDone: ${sent} sent, ${failed} failed out of ${users.length} users`);
  await pool.end();
  return { sent, failed, total: users.length };
}

function buildHtml(firstName, code, referralUrl) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
  <tr><td style="background:linear-gradient(135deg,#0ea5e9,#0284c7);padding:40px 40px 32px;text-align:center">
    <div style="font-size:32px;margin-bottom:8px">🏄</div>
    <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px">Ton code Swell est prêt</h1>
    <p style="margin:8px 0 0;color:#bae6fd;font-size:15px">Gagne €10 chaque fois qu'un pote réserve</p>
  </td></tr>
  <tr><td style="padding:36px 40px">
    <p style="margin:0 0 20px;color:#1e293b;font-size:16px;line-height:1.6">Salut ${firstName},</p>
    <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6">On vient de lancer le programme de parrainage Swell. Chaque fois qu'un ami réserve une planche avec ton lien, <strong>vous gagnez €10 chacun</strong> — lui sur sa prochaine session, toi sur la suivante.</p>
    <div style="background:#f8fafc;border:2px dashed #0ea5e9;border-radius:10px;padding:24px;text-align:center;margin:0 0 28px">
      <p style="margin:0 0 8px;color:#64748b;font-size:13px;text-transform:uppercase;letter-spacing:1px;font-weight:600">Ton code perso</p>
      <div style="font-size:28px;font-weight:700;color:#0284c7;letter-spacing:4px;font-family:monospace">${code}</div>
      <p style="margin:12px 0 0;color:#64748b;font-size:13px">ou partage directement :</p>
      <p style="margin:6px 0 0;word-break:break-all;font-size:13px;color:#0ea5e9">${referralUrl}</p>
    </div>
    <div style="text-align:center;margin:0 0 28px">
      <a href="${referralUrl}" style="display:inline-block;background:#0ea5e9;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 36px;border-radius:8px">Partager mon lien →</a>
    </div>
    <div style="background:#f0fdf4;border-left:4px solid #22c55e;border-radius:0 8px 8px 0;padding:16px 20px;margin:0 0 24px">
      <p style="margin:0;color:#166534;font-size:14px;line-height:1.7">✓ Ton ami doit finaliser sa <strong>première réservation payée</strong><br>✓ €10 de crédit pour toi + €10 pour lui, automatiquement<br>✓ Jusqu'à 5 parrainages (€50 max)</p>
    </div>
    <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6">Questions ? Réponds à cet email ou écris à <a href="mailto:sebastien@swell.fr" style="color:#0ea5e9">sebastien@swell.fr</a></p>
  </td></tr>
  <tr><td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center">
    <p style="margin:0;color:#94a3b8;font-size:12px">Swell — location de planches entre surfeurs, Hossegor<br><a href="${APP_URL}" style="color:#0ea5e9;text-decoration:none">swell.polsia.app</a></p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function buildText(firstName, code, referralUrl) {
  return `Salut ${firstName},

On vient de lancer le programme de parrainage Swell.

Ton code : ${code}
Ton lien : ${referralUrl}

Chaque fois qu'un ami finalise sa première réservation avec ton lien, vous gagnez €10 chacun — automatiquement. Jusqu'à 5 parrainages (€50 max).

Partager → ${referralUrl}

Questions ? sebastien@swell.fr
`;
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
