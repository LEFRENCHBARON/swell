// What this module owns: registration, login, logout, session endpoints.
// Does NOT store sessions in DB — uses signed cookie sessions.
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const router = express.Router();
const { createUser, verifyPassword, getUserById, setEmailVerificationToken, verifyEmail, isEmailVerified, getEmailTokenAge } = require('../db/users');
const { assignReferralCode, getUserByReferralCode, setReferredBy } = require('../db/referrals');
const { sendTransactionalEmail } = require('../services/email');

// After session.regenerate(), the old CSRF token is gone. Mint a fresh one
// and set the XSRF-TOKEN cookie so the frontend has a valid token immediately.
function refreshCsrfToken(req, res) {
  const token = crypto.randomBytes(32).toString('hex');
  req.session.csrfToken = token;
  res.cookie('XSRF-TOKEN', token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
  });
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, name, password } = req.body;
  if (!email || !name || !password) {
    return res.status(400).json({ error: 'email, name, and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  try {
    const user = await createUser({ email, name, password });

    // Generate email verification token and send verification email
    setEmailVerificationToken(user.id).then(token => {
      const verifyUrl = `${process.env.APP_URL || 'https://swell.polsia.app'}/api/auth/verify-email?token=${token}`;
      const firstName = name ? name.split(' ')[0] : '';
      sendTransactionalEmail({
        to: email,
        subject: `${firstName ? firstName + ', ' : ''}confirme ton email pour démarrer sur Swell`,
        htmlBody: `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Confirme ton email — Swell</title>
</head>
<body style="margin:0;padding:0;background:#f0f9fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9fb;padding:32px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
<tr><td style="background:linear-gradient(135deg,#0a6e8c,#00B4D8);padding:32px 32px 28px;text-align:center;border-radius:16px 16px 0 0;">
  <div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-0.5px;">SWELL</div>
  <div style="color:rgba(255,255,255,0.8);font-size:14px;margin-top:4px;">Vérification de ton adresse email</div>
</td></tr>
<tr><td style="background:#ffffff;padding:32px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
  <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0a1628;line-height:1.3;">
    Bienvenue${firstName ? ' ' + firstName : ''} ! 👋
  </h1>
  <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;">
    Confirme ton adresse email pour activer ton compte Swell. Une fois vérifié, tu pourras publier une board et réserver.
  </p>
  <table cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
  <tr><td style="background:#0a6e8c;border-radius:10px;">
    <a href="${verifyUrl}" style="color:#fff;text-decoration:none;font-size:15px;font-weight:700;display:block;padding:14px 32px;text-align:center;">
      Confirmer mon email →
    </a>
  </td></tr>
  </table>
  <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">Ce lien expire dans <strong>24 heures</strong>. Si tu n'as pas demandé cette vérification, ignore ce mail.</p>
</td></tr>
<tr><td style="background:#f0f9fb;padding:20px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;">
  <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">Swell · Hossegor, France</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
        tag: 'email-verification'
      }).catch(err => console.error('[Auth] Verification email failed:', err.message));
    }).catch(err =>
      console.error('[Auth] setEmailVerificationToken failed (non-fatal):', err.message)
    );

    // Assign referral code (non-fatal if it fails)
    assignReferralCode(user.id).catch(err =>
      console.error('[Auth] assignReferralCode failed (non-fatal):', err.message)
    );

    // Attribution: read ref code from cookie (set by frontend on landing with ?ref=CODE)
    const refCode = req.cookies && req.cookies['swell_ref'];
    if (refCode) {
      getUserByReferralCode(refCode).then(inviter => {
        if (inviter && inviter.id !== user.id) {
          return setReferredBy(user.id, inviter.id);
        }
      }).catch(err =>
        console.error('[Auth] setReferredBy failed (non-fatal):', err.message)
      );
    }

    req.session.regenerate((err) => {
      if (err) {
        console.error('Register session regenerate error:', err.message);
        return res.status(500).json({ error: 'Registration failed' });
      }
      req.session.userId = user.id;
      refreshCsrfToken(req, res);
      res.json({ user, lead: true });
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// GET /api/auth/verify-email?token=XXX — clickable link from verification email
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Token manquant.');

  try {
    const user = await verifyEmail(token);
    if (!user) {
      return res.sendFile(path.join(__dirname, '../public/email-verified.html'));
    }
    // Redirect to app with verified=true param so frontend shows success state
    const appUrl = process.env.APP_URL || 'https://swell.polsia.app';
    res.redirect(`${appUrl}/app.html?verified=true`);
  } catch (err) {
    console.error('Verify email error:', err.message);
    res.status(500).send('Erreur lors de la vérification.');
  }
});

// POST /api/auth/resend-verification — rate-limited (1/min/user)
const resendLimiter = require('express-rate-limit')({
  windowMs: 60 * 1000,
  max: 1,
  standardHeaders: true,
  message: { error: 'Trop de requêtes — attendez 1 minute avant de réessayer.' },
  keyGenerator: (req) => String(req.session.userId || req.ip),
});

router.post('/resend-verification', resendLimiter, async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Connexion requise' });

  const user = await getUserById(req.session.userId).catch(() => null);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  if (user.email_verified) return res.status(400).json({ error: 'Email déjà vérifié' });

  const ageMs = await getEmailTokenAge(req.session.userId);
  if (ageMs < 60 * 1000) {
    return res.status(429).json({ error: 'Un lien a déjà été envoyé — attendez 1 minute.' });
  }

  try {
    const token = await setEmailVerificationToken(req.session.userId);
    const verifyUrl = `${process.env.APP_URL || 'https://swell.polsia.app'}/api/auth/verify-email?token=${token}`;
    const firstName = user.name ? user.name.split(' ')[0] : '';
    await sendTransactionalEmail({
      to: user.email,
      subject: `${firstName ? firstName + ', ' : ''}confirme ton email pour démarrer sur Swell`,
      htmlBody: `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Confirme ton email — Swell</title>
</head>
<body style="margin:0;padding:0;background:#f0f9fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9fb;padding:32px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
<tr><td style="background:linear-gradient(135deg,#0a6e8c,#00B4D8);padding:32px 32px 28px;text-align:center;border-radius:16px 16px 0 0;">
  <div style="font-size:28px;font-weight:900;color:#fff;letter-spacing:-0.5px;">SWELL</div>
  <div style="color:rgba(255,255,255,0.8);font-size:14px;margin-top:4px;">Vérification de ton adresse email</div>
</td></tr>
<tr><td style="background:#ffffff;padding:32px;border-left:1px solid #e2e8f0;border-right:1px solid #e2e8f0;">
  <h1 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0a1628;line-height:1.3;">
    Bienvenue${firstName ? ' ' + firstName : ''} ! 👋
  </h1>
  <p style="margin:0 0 20px;font-size:15px;color:#475569;line-height:1.6;">
    Confirme ton adresse email pour activer ton compte Swell. Une fois vérifié, tu pourras publier une board et réserver.
  </p>
  <table cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
  <tr><td style="background:#0a6e8c;border-radius:10px;">
    <a href="${verifyUrl}" style="color:#fff;text-decoration:none;font-size:15px;font-weight:700;display:block;padding:14px 32px;text-align:center;">
      Confirmer mon email →
    </a>
  </td></tr>
  </table>
  <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">Ce lien expire dans <strong>24 heures</strong>.</p>
</td></tr>
<tr><td style="background:#f0f9fb;padding:20px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 16px 16px;">
  <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">Swell · Hossegor, France</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`,
      tag: 'email-verification'
    });
    res.json({ ok: true, message: 'Lien de vérification envoyé' });
  } catch (err) {
    console.error('[Auth] resend-verification error:', err.message);
    res.status(500).json({ error: "Erreur lors de l'envoi du lien" });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  try {
    const user = await verifyPassword(email, password);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    req.session.regenerate((err) => {
      if (err) {
        console.error('Login session regenerate error:', err.message);
        return res.status(500).json({ error: 'Login failed' });
      }
      req.session.userId = user.id;
      refreshCsrfToken(req, res);
      res.json({ user });
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('swell_sid');
    res.clearCookie('XSRF-TOKEN');
    res.json({ ok: true });
  });
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  try {
    const user = await getUserById(req.session.userId);
    res.json({ user });
  } catch (err) {
    res.json({ user: null });
  }
});

module.exports = router;
