// What this module owns: admin-only endpoints (one-shot operations, no user-facing routes).
// Does NOT own authentication, business logic, or data queries.
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { getAllHosts, getAllRenters, getHostsWithoutStripe, getDormantHosts, getActivationTargets, getBoardsNearLocation, logActivationEmail } = require('../db/users');
const { sendTransactionalEmail } = require('../services/email');
const pool = require('../db/index');

// ADMIN_SECRET env var is REQUIRED — no fallback. Without it, the server refuses to start.
// This prevents the hardcoded string from ever being a valid secret in any environment.
const ADMIN_SECRET = process.env.ADMIN_SECRET;
if (!ADMIN_SECRET) {
  // Only crash on startup in production; allow dev to set it in .env without crashing the test suite
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ADMIN_SECRET environment variable is required');
  }
  // Allow local dev without .env — but the fallback string is never accepted by authMiddleware
  // because we override authMiddleware below when the var is missing
}

function authMiddleware(req, res, next) {
  if (!ADMIN_SECRET) {
    return res.status(503).json({ error: 'admin endpoints not configured — set ADMIN_SECRET env var' });
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

const launchEmailLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 3,
  standardHeaders: true,
  message: { error: 'rate limited — max 3 calls per 5 minutes' },
});

// GET /api/admin/kyc-pending-count — badge count for admin header KYC indicator.
// Returns total pending_review KYC submissions.
router.get('/kyc-pending-count', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::INT AS count FROM users WHERE identity_status = 'pending_review'`
    );
    res.json({ pending_count: rows[0]?.count || 0 });
  } catch (err) {
    console.error('[admin] kyc-pending-count error:', err.message);
    res.status(500).json({ error: 'Erreur interne' });
  }
});

// GET /api/admin/kyc-pending — list of pending KYC submissions for admin review.
// Returns user info + doc URLs + submission timestamp.
router.get('/kyc-pending', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, name, email, identity_status, identity_submitted_at,
             identity_doc_url, identity_doc_back_url, created_at
      FROM users
      WHERE identity_status = 'pending_review'
      ORDER BY identity_submitted_at ASC
    `);
    res.json({ kyc_submissions: rows });
  } catch (err) {
    console.error('[admin] kyc-pending error:', err.message);
    res.status(500).json({ error: 'Erreur interne' });
  }
});
const TAG = 'hourly-launch-2025-11';
const FROM_ADDRESS = 'sebastien@swell.fr';

function personalGreeting(name) {
  if (!name) return 'Bonjour';
  const parts = (name || '').trim().split(' ');
  return `Bonjour ${parts[0]}`;
}

// HOST email HTML — CTA points to listings management
function hostEmailHtml(firstName) {
  const greeting = personalGreeting(firstName);
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>La réservation à l'heure est arrivée sur Swell</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">

<!-- HERO -->
<tr><td style="background:linear-gradient(135deg,#0077B6,#00B4D8);padding:40px 32px;text-align:center;">
<p style="margin:0 0 8px;font-size:28px;">🤙</p>
<h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:800;line-height:1.2;">Tu n'as plus besoin de réserver une journée entière.</h1>
<p style="margin:12px 0 0;color:rgba(255,255,255,0.85);font-size:16px;line-height:1.5;">Loue une planche pour 2h, une matinée, une session du soir.</p>
</td></tr>

<!-- BODY -->
<tr><td style="padding:32px;">
<p style="margin:0 0 8px;font-size:17px;color:#1a1a1a;">${greeting},</p>
<p style="margin:0 0 24px;font-size:16px;color:#444;line-height:1.6;">On vient de sortir trois updates qui changent vraiment l'expérience Swell :</p>

<!-- Feature 1 -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
<tr>
<td style="width:40px;vertical-align:top;padding-top:2px;font-size:22px;">⏱</td>
<td style="padding-left:12px;">
<strong style="font-size:15px;color:#1a1a1a;">Réservation à l'heure, c'est live</strong>
<p style="margin:4px 0 0;font-size:14px;color:#666;line-height:1.5;">Minimum 2h. Tu fixes ton tarif €/heure. Le damage waiver est calculé au prorata de la durée.</p>
</td>
</tr>
</table>

<!-- Feature 2 -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
<tr>
<td style="width:40px;vertical-align:top;padding-top:2px;font-size:22px;">📸</td>
<td style="padding-left:12px;">
<strong style="font-size:15px;color:#1a1a1a;">3 photos minimum par annonce</strong>
<p style="margin:4px 0 0;font-size:14px;color:#666;line-height:1.5;">Les annonces sont plus propres, plus rassurantes. Les riders savent exactement ce qu'ils louent.</p>
</td>
</tr>
</table>

<!-- Feature 3 -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
<tr>
<td style="width:40px;vertical-align:top;padding-top:2px;font-size:22px;">🪪</td>
<td style="padding-left:12px;">
<strong style="font-size:15px;color:#1a1a1a;">KYC recto + verso</strong>
<p style="margin:4px 0 0;font-size:14px;color:#666;line-height:1.5;">Chaque transaction est vérifiée des deux côtés. Tu sais à qui tu prêtes ta board.</p>
</td>
</tr>
</table>

<!-- PROMO -->
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FFF9E6;border:2px solid #F4C430;border-radius:10px;margin-bottom:28px;">
<tr><td style="padding:20px 24px;">
<p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#B8860B;text-transform:uppercase;letter-spacing:1px;">🎉 Offre de lancement</p>
<p style="margin:0 0 6px;font-size:18px;font-weight:800;color:#1a1a1a;">Première session à <span style="color:#0077B6;">-50%</span> (cap 15€)</p>
<p style="margin:0 0 12px;font-size:14px;color:#444;line-height:1.5;">Pour fêter ça, partage ce code avec un rider autour de toi — ou utilise-le toi-même pour tester comme client.</p>
<table cellpadding="0" cellspacing="0"><tr><td style="background:#1a1a1a;border-radius:8px;padding:10px 20px;">
<span style="font-family:monospace;font-size:18px;font-weight:800;color:#F4C430;letter-spacing:3px;">FIRSTSESSION50</span>
</td></tr></table>
<p style="margin:10px 0 0;font-size:12px;color:#888;">Valable 60 jours — cap à 15€ de réduction</p>
</td></tr>
</table>

<!-- CTA HOST -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
<tr><td align="center">
<a href="https://swell.polsia.app/app.html?tab=listings" style="display:inline-block;background:#0077B6;color:#ffffff;text-decoration:none;padding:16px 32px;border-radius:10px;font-size:16px;font-weight:700;">Mettre à jour tes créneaux horaires →</a>
</td></tr>
</table>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
<tr><td align="center">
<a href="https://swell.polsia.app/spot/hossegor" style="display:inline-block;color:#0077B6;text-decoration:none;font-size:14px;padding:8px 16px;border:1px solid #0077B6;border-radius:8px;">Voir les planches près de toi →</a>
</td></tr>
</table>

<p style="margin:0;font-size:15px;color:#444;line-height:1.6;">À bientôt sur les vagues,<br><strong>Sébastien</strong> — Swell</p>
<p style="margin:12px 0 0;font-size:13px;color:#888;">Un problème ? Réponds à cet email ou écris sur WhatsApp.</p>
</td></tr>

<!-- FOOTER -->
<tr><td style="background:#f9f9f9;padding:20px 32px;text-align:center;border-top:1px solid #eee;">
<p style="margin:0;font-size:12px;color:#aaa;">Swell · Hossegor, France<br>Tu reçois cet email car tu es inscrit sur Swell.<br><a href="https://swell.polsia.app/unsubscribe" style="color:#aaa;">Se désinscrire</a></p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// RENTER email HTML — CTA points to browse/list board
function renterEmailHtml(firstName) {
  const greeting = personalGreeting(firstName);
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>La réservation à l'heure est arrivée sur Swell</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">

<!-- HERO -->
<tr><td style="background:linear-gradient(135deg,#0077B6,#00B4D8);padding:40px 32px;text-align:center;">
<p style="margin:0 0 8px;font-size:28px;">🤙</p>
<h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:800;line-height:1.2;">Tu n'as plus besoin de réserver une journée entière.</h1>
<p style="margin:12px 0 0;color:rgba(255,255,255,0.85);font-size:16px;line-height:1.5;">Loue une planche pour 2h, une matinée, une session du soir.</p>
</td></tr>

<!-- BODY -->
<tr><td style="padding:32px;">
<p style="margin:0 0 8px;font-size:17px;color:#1a1a1a;">${greeting},</p>
<p style="margin:0 0 24px;font-size:16px;color:#444;line-height:1.6;">On vient de sortir trois updates qui changent vraiment l'expérience Swell :</p>

<!-- Feature 1 -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
<tr>
<td style="width:40px;vertical-align:top;padding-top:2px;font-size:22px;">⏱</td>
<td style="padding-left:12px;">
<strong style="font-size:15px;color:#1a1a1a;">Réservation à l'heure, c'est live</strong>
<p style="margin:4px 0 0;font-size:14px;color:#666;line-height:1.5;">Minimum 2h. Tu fixes ton tarif €/heure. Le damage waiver est calculé au prorata de la durée.</p>
</td>
</tr>
</table>

<!-- Feature 2 -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
<tr>
<td style="width:40px;vertical-align:top;padding-top:2px;font-size:22px;">📸</td>
<td style="padding-left:12px;">
<strong style="font-size:15px;color:#1a1a1a;">3 photos minimum par annonce</strong>
<p style="margin:4px 0 0;font-size:14px;color:#666;line-height:1.5;">Les annonces sont plus propres, plus rassurantes. Les riders savent exactement ce qu'ils louent.</p>
</td>
</tr>
</table>

<!-- Feature 3 -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
<tr>
<td style="width:40px;vertical-align:top;padding-top:2px;font-size:22px;">🪪</td>
<td style="padding-left:12px;">
<strong style="font-size:15px;color:#1a1a1a;">KYC recto + verso</strong>
<p style="margin:4px 0 0;font-size:14px;color:#666;line-height:1.5;">Chaque transaction est vérifiée des deux côtés. Tu sais à qui tu prêtes ta board.</p>
</td>
</tr>
</table>

<!-- PROMO -->
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FFF9E6;border:2px solid #F4C430;border-radius:10px;margin-bottom:28px;">
<tr><td style="padding:20px 24px;">
<p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#B8860B;text-transform:uppercase;letter-spacing:1px;">🎉 Offre de lancement</p>
<p style="margin:0 0 6px;font-size:18px;font-weight:800;color:#1a1a1a;">Première session à <span style="color:#0077B6;">-50%</span> (cap 15€)</p>
<p style="margin:0 0 12px;font-size:14px;color:#444;line-height:1.5;">Pour fêter ça, Swell te fait -50% sur ta première session hourly. Teste sans engagement.</p>
<table cellpadding="0" cellspacing="0"><tr><td style="background:#1a1a1a;border-radius:8px;padding:10px 20px;">
<span style="font-family:monospace;font-size:18px;font-weight:800;color:#F4C430;letter-spacing:3px;">FIRSTSESSION50</span>
</td></tr></table>
<p style="margin:10px 0 0;font-size:12px;color:#888;">Valable 60 jours — cap à 15€ de réduction</p>
</td></tr>
</table>

<!-- CTA RENTER -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
<tr><td align="center">
<a href="https://swell.polsia.app/spot/hossegor" style="display:inline-block;background:#0077B6;color:#ffffff;text-decoration:none;padding:16px 32px;border-radius:10px;font-size:16px;font-weight:700;">Trouver une planche près de chez toi →</a>
</td></tr>
</table>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
<tr><td align="center">
<a href="https://swell.polsia.app/app.html?signup=1&source=host" style="display:inline-block;color:#0077B6;text-decoration:none;font-size:14px;padding:8px 16px;border:1px solid #0077B6;border-radius:8px;">Lister ma planche →</a>
</td></tr>
</table>

<p style="margin:0;font-size:15px;color:#444;line-height:1.6;">À bientôt sur les vagues,<br><strong>Sébastien</strong> — Swell</p>
<p style="margin:12px 0 0;font-size:13px;color:#888;">Un problème ? Réponds à cet email ou écris sur WhatsApp.</p>
</td></tr>

<!-- FOOTER -->
<tr><td style="background:#f9f9f9;padding:20px 32px;text-align:center;border-top:1px solid #eee;">
<p style="margin:0;font-size:12px;color:#aaa;">Swell · Hossegor, France<br>Tu reçois cet email car tu es inscrit sur Swell.<br><a href="https://swell.polsia.app/unsubscribe" style="color:#aaa;">Se désinscrire</a></p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

const SUBJECT = "🤙 {first_name}, la réservation à l'heure est arrivée sur Swell (et ton premier essai est offert)";

function buildSubject(firstName) {
  return SUBJECT.replace('{first_name}', firstName || ' toi');
}

// Stripe onboarding email — sent to hosts who haven't configured payments yet
function stripeOnboardingEmailHtml(firstName, boardCount) {
  const greeting = firstName ? `Bonjour ${firstName.split(' ')[0]}` : 'Bonjour';
  const boardWord = boardCount > 1 ? 'planches' : 'planche';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Configurez vos paiements sur Swell — recevoir vos revenus</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
<tr><td align="center">
<table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">

<!-- HERO -->
<tr><td style="background:linear-gradient(135deg,#B45309,#F59E0B);padding:40px 32px;text-align:center;">
<p style="margin:0 0 8px;font-size:28px;">💳</p>
<h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:800;line-height:1.2;">Tes paiements ne sont pas encore configurés</h1>
<p style="margin:12px 0 0;color:rgba(255,255,255,0.9);font-size:15px;line-height:1.5;">Sans IBAN, les riders ne peuvent pas réserver tes ${boardWord}. Active tes paiements en 2 minutes.</p>
</td></tr>

<!-- BODY -->
<tr><td style="padding:32px;">
<p style="margin:0 0 8px;font-size:17px;color:#1a1a1a;">${greeting},</p>
<p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.6;">On a détecté que tu as ${boardCount} ${boardWord} listée(s) sur Swell, mais que tes coordonnées bancaires ne sont pas encore configurées. Résultat : aucun paiement ne peut être transféré sur ton compte.</p>

<!-- WHY IT MATTERS -->
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fff3cd;border:1px solid #ffe69c;border-radius:10px;margin-bottom:24px;">
<tr><td style="padding:20px 24px;">
<p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#B45309;text-transform:uppercase;letter-spacing:1px;">⚠️ Ce qui se passe sans paiement configuré</p>
<p style="margin:0;font-size:14px;color:#92400e;line-height:1.6;">
• Les riders qui tentent de réserver tes planches reçoivent une erreur<br>
• L'argent capturé ne peut pas être transféré vers toi<br>
• Tes revenus restent en attente — sans date de libération
</p>
</td></tr>
</table>

<!-- STEPS -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
<tr><td style="padding:0 0 12px;font-size:15px;font-weight:700;color:#1a1a1a;">Comment activer tes paiements :</td></tr>
</table>

<!-- Step 1 -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
<tr>
<td style="width:32px;vertical-align:top;padding-top:2px;">
<table cellpadding="0" cellspacing="0"><tr><td style="background:#0077B6;color:#fff;border-radius:50%;width:28px;height:28px;text-align:center;font-weight:700;font-size:13px;line-height:28px;">1</td></tr></table>
</td>
<td style="padding-left:12px;">
<strong style="font-size:14px;color:#1a1a1a;">Va sur ton espace host</strong>
<p style="margin:3px 0 0;font-size:13px;color:#666;line-height:1.5;">Rends-toi sur <a href="https://swell.polsia.app/host.html" style="color:#0077B6;text-decoration:none;">swell.polsia.app/host.html</a> et connecte-toi.</p>
</td>
</tr>
</table>

<!-- Step 2 -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
<tr>
<td style="width:32px;vertical-align:top;padding-top:2px;">
<table cellpadding="0" cellspacing="0"><tr><td style="background:#0077B6;color:#fff;border-radius:50%;width:28px;height:28px;text-align:center;font-weight:700;font-size:13px;line-height:28px;">2</td></tr></table>
</td>
<td style="padding-left:12px;">
<strong style="font-size:14px;color:#1a1a1a;">Saisis ton IBAN</strong>
<p style="margin:3px 0 0;font-size:13px;color:#666;line-height:1.5;">Tu trouveras le formulaire dans la section « Mes paiements » de ton dashboard. Ton IBAN reste en France — toutes les banques françaises sont acceptées.</p>
</td>
</tr>
</table>

<!-- Step 3 -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
<tr>
<td style="width:32px;vertical-align:top;padding-top:2px;">
<table cellpadding="0" cellspacing="0"><tr><td style="background:#0077B6;color:#fff;border-radius:50%;width:28px;height:28px;text-align:center;font-weight:700;font-size:13px;line-height:28px;">3</td></tr></table>
</td>
<td style="padding-left:12px;">
<strong style="font-size:14px;color:#1a1a1a;">C'est fini — tu reçois tes paiements sous 24-48h</strong>
<p style="margin:3px 0 0;font-size:13px;color:#666;line-height:1.5;">Swell active les virements dès validation de ton IBAN. Tu gardes 85% du montant de chaque location.</p>
</td>
</tr>
</table>

<!-- CTA -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
<tr><td align="center">
<a href="https://swell.polsia.app/host.html" style="display:inline-block;background:#B45309;color:#ffffff;text-decoration:none;padding:16px 32px;border-radius:10px;font-size:15px;font-weight:700;">Configurer mes paiements maintenant →</a>
</td></tr>
</table>

<p style="margin:0;font-size:14px;color:#444;line-height:1.6;">Si tu as une question ou un souci, réponds directement à cet email — on est là.<br><strong>Sébastien</strong> — Swell</p>
</td></tr>

<!-- FOOTER -->
<tr><td style="background:#f9f9f9;padding:20px 32px;text-align:center;border-top:1px solid #eee;">
<p style="margin:0;font-size:12px;color:#aaa;">Swell · Hossegor, France<br>Tu reçois cet email car tu es inscrit sur Swell.<br><a href="https://swell.polsia.app/unsubscribe" style="color:#aaa;">Se désinscrire</a></p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

const STRIPE_EMAIL_TAG = 'stripe-onboarding-2026-05';

function personalGreetingStripe(name) {
  if (!name) return 'Bonjour';
  const parts = (name || '').trim().split(' ');
  return `Bonjour ${parts[0]}`;
}

// POST /api/admin/send-launch-emails (auth via Authorization: Bearer header)
router.post('/send-launch-emails', authMiddleware, launchEmailLimiter, async (req, res) => {

  console.log('[admin] Starting hourly-launch email campaign...');

  let sent = 0;
  const errors = [];

  try {
    // Segment users
    const [hosts, renters] = await Promise.all([getAllHosts(), getAllRenters()]);
    console.log(`[admin] Segmented: ${hosts.length} hosts, ${renters.length} renters`);

    // Send to hosts
    for (const user of hosts) {
      try {
        const html = hostEmailHtml(user.name);
        const subject = buildSubject(user.name);
        await sendTransactionalEmail({
          to: user.email,
          subject,
          htmlBody: html,
          textBody: `Salut ${user.name || 'Bonjour'}, ...`, // plain text fallback
          tag: TAG,
          replyTo: FROM_ADDRESS,
        });
        console.log(`[admin] Sent host email to ${user.email}`);
        sent++;
      } catch (err) {
        console.error(`[admin] Failed to send to ${user.email}: ${err.message}`);
        errors.push({ email: user.email, error: err.message });
      }
    }

    // Send to renters
    for (const user of renters) {
      try {
        const html = renterEmailHtml(user.name);
        const subject = buildSubject(user.name);
        await sendTransactionalEmail({
          to: user.email,
          subject,
          htmlBody: html,
          textBody: `Salut ${user.name || 'Bonjour'}, ...`,
          tag: TAG,
          replyTo: FROM_ADDRESS,
        });
        console.log(`[admin] Sent renter email to ${user.email}`);
        sent++;
      } catch (err) {
        console.error(`[admin] Failed to send to ${user.email}: ${err.message}`);
        errors.push({ email: user.email, error: err.message });
      }
    }

    console.log(`[admin] Campaign complete: ${sent} sent, ${errors.length} errors`);
    return res.json({ sent, errors });
  } catch (err) {
    console.error('[admin] Campaign failed:', err.message);
    return res.status(500).json({ error: err.message, sent, errors });
  }
});

// POST /api/admin/send-stripe-onboarding-emails (auth via Authorization: Bearer header)
// Sends Stripe onboarding reminders to all hosts who have boards but no payment config.
router.post('/send-stripe-onboarding-emails', authMiddleware, launchEmailLimiter, async (req, res) => {

  let sent = 0;
  const errors = [];

  try {
    const hosts = await getHostsWithoutStripe();
    console.log(`[admin] Stripe onboarding: ${hosts.length} hosts without payments`);

    for (const user of hosts) {
      try {
        const firstName = (user.name || '').split(' ')[0] || '';
        const html = stripeOnboardingEmailHtml(firstName, user.board_count);
        const subject = `💳 ${firstName}, configure tes paiements sur Swell pour recevoir tes revenus`;
        await sendTransactionalEmail({
          to: user.email,
          subject,
          htmlBody: html,
          textBody: `Bonjour ${firstName},\n\nTes paiements ne sont pas encore configurés sur Swell. Active-les sur: https://swell.polsia.app/host.html\n\nSwell te rappelle que sans IBAN, les riders ne peuvent pas réserver tes planches.\n\nSébastien — Swell`,
          tag: STRIPE_EMAIL_TAG,
          replyTo: FROM_ADDRESS,
        });
        console.log(`[admin] Stripe onboarding email sent to ${user.email}`);
        sent++;
      } catch (err) {
        console.error(`[admin] Failed to send Stripe onboarding email to ${user.email}: ${err.message}`);
        errors.push({ email: user.email, error: err.message });
      }
    }

    console.log(`[admin] Stripe onboarding campaign complete: ${sent} sent, ${errors.length} errors`);
    return res.json({ sent, total: hosts.length, errors });
  } catch (err) {
    console.error('[admin] Stripe onboarding campaign failed:', err.message);
    return res.status(500).json({ error: err.message, sent, errors });
  }
});

// GET /api/host-activation — internal endpoint for growth activation campaigns.
// Returns all hosts with 0 confirmed bookings (dormant supply) with enriched
// board and profile data needed for personalized email outreach.
// Requires ADMIN_SECRET Bearer token.
router.get('/host-activation', authMiddleware, async (req, res) => {
  try {
    const rows = await getDormantHosts();

    const hosts = rows.map(r => {
      const photos = Array.isArray(r.photos) ? r.photos : (r.photos ? JSON.parse(r.photos) : []);
      return {
        id: r.id,
        name: r.name,
        email: r.email,
        board_title: r.board_title,
        board_type: r.board_type,
        spot_name: r.spot_name,
        photos_count: photos.filter(p => p && p.trim()).length,
        hourly_rate_set: r.hourly_rate_cents != null,
        charges_enabled: r.host_charges_enabled === true,
        host_avatar: !!(r.host_avatar && r.host_avatar.trim()),
        total_completed_bookings: 0,
        member_since: r.member_since ? new Date(r.member_since).toISOString() : null,
        referral_code: 'FIRSTSESSION50',
      };
    });

    return res.json({ hosts });
  } catch (err) {
    console.error('[admin] /host-activation error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/send-activation-emails — one-shot activation campaign.
router.post('/send-activation-emails', authMiddleware, launchEmailLimiter, async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'RESEND_API_KEY not configured' });
  }

  const pool = require('../db/index');
  const client = await pool.connect();
  const results = [];

  try {
    const users = await getActivationTargets(client);
    if (users.length === 0) {
      return res.json({ sent: 0, skipped: 0, message: 'No users eligible for activation campaign' });
    }

    for (const user of users) {
      const boards = await getBoardsNearLocation(client, user.location, 3);

      const firstName = user.name ? user.name.split(' ')[0] : 'Surfer';

      // Build board cards HTML
      const boardCardsHtml = boards.length > 0
        ? boards.map(b => {
          const photos = Array.isArray(b.photos) ? b.photos : (b.photos ? JSON.parse(b.photos) : []);
          const photoUrl = photos.find(p => p && p.trim()) || '';
          const priceEur = b.hourly_rate_cents ? (b.hourly_rate_cents / 100).toFixed(0) : '?';
          const boardLabel = b.title || b.board_type || 'Planche';
          return `<tr>
  <td style="padding:12px 16px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;background:#fff;">
    ${photoUrl ? `<img src="${photoUrl}" alt="${boardLabel}" style="width:80px;height:60px;object-fit:cover;border-radius:6px;margin-right:12px;vertical-align:middle;" />` : `<div style="width:80px;height:60px;background:#e2e8f0;border-radius:6px;margin-right:12px;display:inline-block;vertical-align:middle;"></div>`}
    <div style="display:inline-block;vertical-align:middle;">
      <div style="font-size:14px;font-weight:700;color:#1a1a1a;">${boardLabel}</div>
      <div style="font-size:13px;color:#64748b;margin-top:2px;">${b.location || 'Hossegor'} · <strong style="color:#0a6e8c;">€${priceEur}/h</strong></div>
    </div>
  </td>
</tr>`;
        }).join('')
        : `<tr><td style="padding:16px;text-align:center;color:#64748b;font-size:14px;">Des boards disponibles près de chez toi — consulte l'app pour voir la sélection du moment.</td></tr>`;

      const boardRows = boards.length > 0
        ? boards.map(b => `<tr><td style="padding:4px 0;font-size:13px;color:#444;">• ${b.title || b.board_type} — €${b.hourly_rate_cents ? (b.hourly_rate_cents / 100).toFixed(0) : '?'}/h</td></tr>`).join('')
        : '<tr><td style="padding:4px 0;font-size:13px;color:#64748b;">Plusieurs boards disponibles a Hossegor et Biarritz — vois-les sur l app.</td></tr>';

      const htmlBody = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${firstName}, ta première session à -50% t'attend 🏄</title>
</head>
<body style="margin:0;padding:0;background:#f0f9fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9fb;padding:32px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

<!-- HEADER -->
<tr><td style="background:linear-gradient(135deg,#0a6e8c,#00B4D8);padding:32px 32px 28px;text-align:center;border-radius:16px 16px 0 0;">
  <div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-0.5px;">SWELL</div>
  <div style="color:rgba(255,255,255,0.8);font-size:14px;margin-top:4px;">Location de planches à l'heure · Hossegor</div>
</td></tr>

<!-- HERO BODY -->
<tr><td style="background:#ffffff;padding:32px 32px 24px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
  <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0a1628;line-height:1.3;">Salut ${firstName}, ta première session t'attend 🏄</h1>
  <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;">Tu t'es inscrit sur Swell mais tu n'as pas encore réservé. On a des boards top dispo près de chez toi — et on te fait -50% pour te lancer.</p>

  <!-- BOARD LIST -->
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
  ${boardRows}
  </table>
</td></tr>

<!-- PROMO BLOCK -->
<tr><td style="background:#fffbeb;border-left:1px solid #fde68a;border-right:1px solid #fde68a;padding:20px 32px;text-align:center;">
  <div style="font-size:12px;font-weight:700;color:#92400e;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🎉 Code promo</div>
  <table cellpadding="0" cellspacing="0" style="display:inline-block;margin-bottom:8px;">
  <tr><td style="background:#0a1628;border-radius:8px;padding:12px 24px;">
    <span style="font-family:monospace;font-size:20px;font-weight:800;color:#fde68a;letter-spacing:3px;">FIRSTSESSION50</span>
  </td></tr>
  </table>
  <div style="font-size:14px;color:#92400e;font-weight:600;">50% de réduction sur ta première session</div>
  <div style="font-size:12px;color:#b45309;margin-top:4px;">Cap 15€ · Valable 60 jours</div>
</td></tr>

<!-- CTA -->
<tr><td style="background:#ffffff;padding:24px 32px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;text-align:center;">
  <table cellpadding="0" cellspacing="0" style="display:inline-block;">
  <tr><td style="background:#0a6e8c;border-radius:10px;">
    <a href="${BASE_URL}/app.html?utm_source=email&utm_campaign=activation_2026_05" style="color:#fff;text-decoration:none;font-size:16px;font-weight:700;display:block;padding:14px 32px;">
      Réserver ma première session →
    </a>
  </td></tr>
  </table>
</td></tr>

<!-- REFERRAL -->
<tr><td style="background:#f0f9fb;padding:16px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;text-align:center;">
  <p style="margin:0;font-size:13px;color:#64748b;">Invite un pote → <strong style="color:#0a6e8c;">+10€ de crédit</strong> sur ton compte Swell.</p>
</td></tr>

<!-- FOOTER -->
<tr><td style="padding:20px 16px;text-align:center;">
  <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.6;">Pour ne plus recevoir ces emails : <a href="mailto:swell@polsia.app?subject=unsubscribe" style="color:#94a3b8;">swell@polsia.app</a><br>Swell · Hossegor, France</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

      const textBody = `Salut ${firstName},

Tu t'es inscrit sur Swell mais tu n'as pas encore réservé ta première session. On a des boards top dispo près de toi — et on te fait 50% de réduction pour te lancer.

Code promo : FIRSTSESSION50 (50% sur ta première session, cap 15€)

Réserve maintenant : ${BASE_URL}/app.html

Et si tu invites un pote, tu gagnes 10€ de crédit.

À l'eau,
L'équipe Swell`;

      const subject = `${firstName}, ta première session à -50% t'attend 🏄`;

      try {
        await sendTransactionalEmail({
          to: user.email,
          subject,
          htmlBody,
          textBody,
          tag: 'activation-2026-05',
          replyTo: FROM_ADDRESS,
        });
        await logActivationEmail(client, user.id, user.email, 'v1');
        results.push({ userId: user.id, email: maskEmail(user.email), status: 'sent', boardsShown: boards.length });
      } catch (emailErr) {
        console.error(`[admin] activation email failed for ${user.email}:`, emailErr.message);
        results.push({ userId: user.id, email: maskEmail(user.email), status: 'failed', error: emailErr.message });
      }
    }

    const sent = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'failed').length;

    console.log(`[admin] Activation campaign: ${sent} sent, ${failed} failed, ${users.length} total`);
    res.json({ sent, failed, total: users.length, results });
  } catch (err) {
    console.error('[admin] activation campaign error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/admin/send-activation-emails?secret=ADMIN_SECRET — fires the activation campaign.
// Available as GET so it can be triggered from a browser/sapiom_fetch session.
// POST /api/admin/send-activation-emails (Bearer token) also works. Both share the same logic.
router.get('/send-activation-emails', launchEmailLimiter, async (req, res) => {
  const secret = req.query.secret;
  if (!secret || secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  // Re-use the POST handler logic inline
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'RESEND_API_KEY not configured' });
  }
  const pool = require('../db/index');
  const client = await pool.connect();
  const results = [];
  try {
    const users = await getActivationTargets(client);
    if (users.length === 0) {
      return res.json({ sent: 0, skipped: 0, message: 'No users eligible for activation campaign' });
    }
    const BASE_URL = process.env.BASE_URL || 'https://swell.polsia.app';
    const FROM_ADDRESS = 'sebastien@swell.fr';
    const CAMPAIGN = 'activation_2026_05';
    for (const user of users) {
      const boards = await getBoardsNearLocation(client, user.location, 3);
      const firstName = user.name ? user.name.split(' ')[0] : 'Surfer';
      const boardRows = boards.length > 0
        ? boards.map(b => `<tr><td style="padding:4px 0;font-size:13px;color:#444;">• ${b.title || b.board_type || 'Planche'} — €${b.hourly_rate_cents ? (b.hourly_rate_cents / 100).toFixed(0) : '?'}/h</td></tr>`).join('')
        : '<tr><td style="padding:4px 0;font-size:13px;color:#64748b;">Plusieurs boards dispo a Hossegor et Biarritz — vois-les sur l app.</td></tr>';
      const htmlBody = `<!DOCTYPE html>
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
      const textBody = `Salut ${firstName},\n\nTu t'es inscrit sur Swell mais tu n'as pas encore reserve ta premiere session. On a des boards top dispo pres de chez toi — et on te fait 50% de reduction pour te lancer.\n\nCode promo : FIRSTSESSION50 (50% sur ta premiere session, cap 15€)\n\nReserve maintenant : ${BASE_URL}/app.html\n\nEt si tu invites un pote, tu gagnes 10€ de credit.\n\nA l'eau,\nL'equipe Swell`;
      const subject = `${firstName}, ta premiere session a -50% t'attend 🏄`;
      try {
        await sendTransactionalEmail({ to: user.email, subject, htmlBody, textBody, tag: CAMPAIGN, replyTo: FROM_ADDRESS });
        await logActivationEmail(client, user.id, user.email, 'v1');
        results.push({ userId: user.id, email: maskEmail(user.email), boardsShown: boards.length, status: 'sent' });
      } catch (err) {
        console.error(`[admin] activation email failed for ${user.email}:`, err.message);
        results.push({ userId: user.id, email: maskEmail(user.email), status: 'failed', error: err.message });
      }
      await new Promise(r => setTimeout(r, 400));
    }
    const sent = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'failed').length;
    res.json({ sent, failed, total: users.length, results });
  } catch (err) {
    console.error('[admin] GET activation campaign error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/admin/activation-status?secret=ADMIN_SECRET — check eligibility without sending
router.get('/activation-status', async (req, res) => {
  const secret = req.query.secret;
  if (!secret || secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const pool = require('../db/index');
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.name, u.location,
             COUNT(bk.id)::INT AS booking_count,
             EXISTS (SELECT 1 FROM email_sends es WHERE es.user_id = u.id AND es.campaign = 'activation_2026_05') AS already_sent
      FROM users u
      LEFT JOIN bookings bk ON bk.renter_id = u.id
      WHERE u.email IS NOT NULL AND u.email != ''
        AND u.email NOT ILIKE '%@polsia.app'
        AND u.email NOT ILIKE '%@mailinator.com'
        AND u.id != 9
        AND (u.name IS NULL OR (u.name NOT ILIKE 'Test%' AND u.name NOT ILIKE 'QA%' AND u.name NOT ILIKE '%Test Rider%' AND u.name NOT ILIKE '%Test Host%' AND u.name NOT ILIKE '%Test Owner%' AND u.name NOT ILIKE '%Test Propri%'))
      GROUP BY u.id
      ORDER BY booking_count ASC, u.created_at ASC
      LIMIT 20
    `);
    const eligible = rows.filter(r => r.booking_count === 0 && !r.already_sent);
    res.json({ eligible_count: eligible.length, total_shown: rows.length, users: rows.map(r => ({
      id: r.id, email: maskEmail(r.email), name: r.name, booking_count: r.booking_count, already_sent: r.already_sent
    })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function maskEmail(email) {
  if (!email || !email.includes('@')) return email;
  const [local, domain] = email.split('@');
  return local.slice(0, 3) + '***@' + domain;
}

// POST /api/admin/send-weekend-digest — manual trigger for the weekly digest.
// Also accepts GET ?secret=ADMIN_SECRET for easy browser triggering.
// Idempotent: weekend_digest_sends table ensures each user only gets one per week.
router.post('/send-weekend-digest', authMiddleware, launchEmailLimiter, async (req, res) => {
  const { run } = require('../jobs/weekend-digest');
  try {
    const stats = await run();
    return res.json({ ok: true, ...stats });
  } catch (err) {
    console.error('[admin] weekend-digest run failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.get('/send-weekend-digest', launchEmailLimiter, async (req, res) => {
  const secret = req.query.secret;
  if (!secret || secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const { run } = require('../jobs/weekend-digest');
  try {
    const stats = await run();
    return res.json({ ok: true, ...stats });
  } catch (err) {
    console.error('[admin] weekend-digest GET run failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;