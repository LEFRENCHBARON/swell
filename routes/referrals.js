// What this module owns: referral code lookup, referral stats for authenticated users, and admin email campaign trigger.
// Does NOT own booking creation, payment processing, or credit application at checkout.
const express = require('express');
const router = express.Router();
const {
  getUserByReferralCode,
  getReferralStats,
  getAllUsersWithReferralCodes
} = require('../db/referrals');
const { sendTransactionalEmail } = require('../services/email');

const APP_URL = process.env.APP_URL || 'https://swell.polsia.app';
const CRON_SECRET = () => process.env.CRON_SECRET;
const ADMIN_SECRET = () => process.env.ADMIN_SECRET;

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Login required' });
  next();
}

// GET /api/referrals/me — referral stats + personal link for the invite card
router.get('/me', requireAuth, async (req, res) => {
  try {
    const stats = await getReferralStats(req.session.userId);
    if (!stats) return res.status(404).json({ error: 'User not found' });
    res.json({
      referralCode: stats.referralCode,
      referralUrl: `${APP_URL}/?ref=${stats.referralCode}`,
      creditCents: stats.creditCents,
      totalRedemptions: stats.totalRedemptions,
      remainingSlots: stats.remainingSlots
    });
  } catch (err) {
    console.error('[Referrals] /me error:', err.message);
    res.status(500).json({ error: 'Failed to load referral info' });
  }
});

// GET /api/referrals/lookup?code=XXX — resolve a code to inviter name (used for the welcome banner)
router.get('/lookup', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'code required' });
  try {
    const inviter = await getUserByReferralCode(code);
    if (!inviter) return res.status(404).json({ error: 'Code invalide' });
    res.json({ valid: true, inviterName: inviter.name });
  } catch (err) {
    res.status(500).json({ error: 'Lookup failed' });
  }
});

// POST /api/referrals/send-launch-email — send campaign to all existing users.
// Secured by CRON_SECRET. One-shot; idempotent by construction (just sends the email).
router.post('/send-launch-email', async (req, res) => {
  const secret = CRON_SECRET();
  if (!secret) return res.status(503).json({ error: 'CRON_SECRET not configured' });
  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  if (auth !== secret) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const users = await getAllUsersWithReferralCodes();
    const results = [];

    for (const user of users) {
      if (!user.referral_code) continue;
      const referralUrl = `${APP_URL}/?ref=${user.referral_code}`;
      try {
        await sendTransactionalEmail({
          to: user.email,
          subject: 'Ton code Swell est prêt — €10 pour toi, €10 pour ton pote',
          tag: 'referral-launch',
          htmlBody: buildReferralLaunchEmail(user.name, user.referral_code, referralUrl),
          textBody: buildReferralLaunchEmailText(user.name, user.referral_code, referralUrl)
        });
        results.push({ id: user.id, email: user.email, status: 'sent' });
      } catch (emailErr) {
        console.error(`[Referrals] Email failed for ${user.email}:`, emailErr.message);
        results.push({ id: user.id, email: user.email, status: 'failed', error: emailErr.message });
      }
    }

    res.json({ sent: results.filter(r => r.status === 'sent').length, results });
  } catch (err) {
    console.error('[Referrals] send-launch-email error:', err.message);
    res.status(500).json({ error: 'Failed to send launch emails' });
  }
});

function buildReferralLaunchEmail(name, code, referralUrl) {
  const firstName = name ? name.split(' ')[0] : 'Surfeur';
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
  <!-- Header -->
  <tr>
    <td style="background:linear-gradient(135deg,#0ea5e9,#0284c7);padding:40px 40px 32px;text-align:center">
      <div style="font-size:32px;margin-bottom:8px">🏄</div>
      <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px">Ton code Swell est prêt</h1>
      <p style="margin:8px 0 0;color:#bae6fd;font-size:15px">Gagne €10 chaque fois qu'un pote réserve</p>
    </td>
  </tr>
  <!-- Body -->
  <tr>
    <td style="padding:36px 40px">
      <p style="margin:0 0 20px;color:#1e293b;font-size:16px;line-height:1.6">Salut ${firstName},</p>
      <p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6">
        On vient de lancer le programme de parrainage Swell. Chaque fois qu'un ami réserve une planche avec ton lien, <strong>vous gagnez €10 chacun</strong> — lui sur sa prochaine session, toi sur la suivante.
      </p>
      <!-- Code block -->
      <div style="background:#f8fafc;border:2px dashed #0ea5e9;border-radius:10px;padding:24px;text-align:center;margin:0 0 28px">
        <p style="margin:0 0 8px;color:#64748b;font-size:13px;text-transform:uppercase;letter-spacing:1px;font-weight:600">Ton code perso</p>
        <div style="font-size:28px;font-weight:700;color:#0284c7;letter-spacing:4px;font-family:monospace">${code}</div>
        <p style="margin:12px 0 0;color:#64748b;font-size:13px">ou partage directement :</p>
        <p style="margin:6px 0 0;word-break:break-all;font-size:13px;color:#0ea5e9">${referralUrl}</p>
      </div>
      <!-- CTA -->
      <div style="text-align:center;margin:0 0 28px">
        <a href="${referralUrl}" style="display:inline-block;background:#0ea5e9;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 36px;border-radius:8px">
          Partager mon lien →
        </a>
      </div>
      <!-- Rules -->
      <div style="background:#f0fdf4;border-left:4px solid #22c55e;border-radius:0 8px 8px 0;padding:16px 20px;margin:0 0 24px">
        <p style="margin:0;color:#166534;font-size:14px;line-height:1.7">
          ✓ Ton ami doit finaliser sa <strong>première réservation payée</strong><br>
          ✓ €10 de crédit pour toi + €10 pour lui, automatiquement<br>
          ✓ Jusqu'à 5 parrainages (€50 max)
        </p>
      </div>
      <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6">
        Questions ? Réponds à cet email ou écris à <a href="mailto:sebastien@swell.fr" style="color:#0ea5e9">sebastien@swell.fr</a>
      </p>
    </td>
  </tr>
  <!-- Footer -->
  <tr>
    <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center">
      <p style="margin:0;color:#94a3b8;font-size:12px">
        Swell — location de planches entre surfeurs, Hossegor<br>
        <a href="${APP_URL}" style="color:#0ea5e9;text-decoration:none">swell.polsia.app</a>
      </p>
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function buildReferralLaunchEmailText(name, code, referralUrl) {
  const firstName = name ? name.split(' ')[0] : 'Surfeur';
  return `Salut ${firstName},

On vient de lancer le programme de parrainage Swell.

Ton code : ${code}
Ton lien : ${referralUrl}

Chaque fois qu'un ami finalise sa première réservation avec ton lien, vous gagnez €10 chacun — automatiquement. Jusqu'à 5 parrainages (€50 max).

Partage ton lien → ${referralUrl}

Questions ? sebastien@swell.fr
`;
}

// GET /api/referrals/trigger-launch?secret=XXX — one-shot GET trigger for launch campaign.
// Works two ways:
//   - ?secret=ADMIN_SECRET   (simple browser URL, no headers needed)
//   - Authorization: Bearer ADMIN_SECRET header
router.get('/trigger-launch', async (req, res) => {
  const secret = ADMIN_SECRET();
  if (!secret) return res.status(503).json({ error: 'ADMIN_SECRET not configured' });
  const bearer = (req.headers.authorization || '').replace('Bearer ', '');
  const querySecret = req.query.secret || '';
  if (querySecret !== secret && bearer !== secret) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const users = await getAllUsersWithReferralCodes();
    const results = [];
    for (const user of users) {
      if (!user.referral_code) continue;
      const referralUrl = `${APP_URL}/?ref=${user.referral_code}`;
      try {
        await sendTransactionalEmail({
          to: user.email,
          subject: 'Ton code Swell est prêt — €10 pour toi, €10 pour ton pote',
          tag: 'referral-launch',
          htmlBody: buildReferralLaunchEmail(user.name, user.referral_code, referralUrl),
          textBody: buildReferralLaunchEmailText(user.name, user.referral_code, referralUrl)
        });
        results.push({ id: user.id, email: user.email, status: 'sent' });
      } catch (emailErr) {
        console.error(`[Referrals] Email failed for ${user.email}:`, emailErr.message);
        results.push({ id: user.id, email: user.email, status: 'failed', error: emailErr.message });
      }
    }
    const sent = results.filter(r => r.status === 'sent').length;
    res.json({ sent, total: users.length, results });
  } catch (err) {
    console.error('[Referrals] trigger-launch error:', err.message);
    res.status(500).json({ error: 'Failed to send launch emails' });
  }
});

module.exports = router;
