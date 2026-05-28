// What this module owns: identity verification flow — document submission (front + back), status, admin review.
// Does NOT handle bookings, auth tokens, or payment logic.
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { submitIdentityDoc, approveIdentity, rejectIdentity, getIdentityStatus, getUserById } = require('../db/users');
const { activatePendingKycBoards } = require('../db/boards');
const { sendTransactionalEmail } = require('../services/email');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const cloudinary = require('cloudinary').v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadToCloudinary(buffer, folder = 'swell') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'auto' },
      (err, result) => { if (err) reject(err); else resolve(result.secure_url); }
    );
    stream.end(buffer);
  });
}


function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Connexion requise' });
  next();
}

// Maps MIME type to file extension for R2 storage filenames.
function getExt(mimetype) {
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
  };
  return map[mimetype] || '';
}

async function uploadDocToR2(buffer, _filename, _mimetype) {
  return uploadToCloudinary(buffer, 'swell/identity');
}

// GET /api/identity/status — get current user's identity status + doc URLs for preview
router.get('/status', requireAuth, async (req, res) => {
  try {
    const status = await getIdentityStatus(req.session.userId);
    if (!status) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json({ identity: status });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la vérification du statut' });
  }
});

// POST /api/identity/submit — submit identity document front + back
router.post('/submit', requireAuth, upload.fields([{ name: 'doc_front', maxCount: 1 }, { name: 'doc_back', maxCount: 1 }]), async (req, res) => {
  if (!req.files?.doc_front?.[0]) {
    return res.status(400).json({ error: 'Photo recto requise' });
  }
  if (!req.files?.doc_back?.[0]) {
    return res.status(400).json({ error: 'Photo verso requise' });
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  const front = req.files.doc_front[0];
  const back = req.files.doc_back[0];

  if (!allowedTypes.includes(front.mimetype)) {
    return res.status(400).json({ error: 'Format recto invalide — acceptés : JPG, PNG, WEBP, PDF' });
  }
  if (!allowedTypes.includes(back.mimetype)) {
    return res.status(400).json({ error: 'Format verso invalide — acceptés : JPG, PNG, WEBP, PDF' });
  }

  try {
    const current = await getIdentityStatus(req.session.userId);
    if (current?.identity_status === 'verified') {
      return res.json({ success: true, status: 'verified', message: 'Identité déjà vérifiée' });
    }

    const [frontUrl, backUrl] = await Promise.all([
      uploadDocToR2(front.buffer, `identity_${req.session.userId}_front_${Date.now()}${getExt(front.mimetype)}`, front.mimetype),
      uploadDocToR2(back.buffer, `identity_${req.session.userId}_back_${Date.now()}${getExt(back.mimetype)}`, back.mimetype)
    ]);

    const result = await submitIdentityDoc(req.session.userId, frontUrl, backUrl);

    // ── Notify admin of new KYC submission ─────────────────────────────────
    const user = await getUserById(req.session.userId);
    const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || process.env.POLSIA_OWNER_EMAIL;
    if (user && adminEmail) {
      const submittedAt = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
      const adminLink = `${process.env.APP_URL || 'https://swell.polsia.app'}/admin/kyc/${user.id}`;
      sendTransactionalEmail({
        to: adminEmail,
        subject: `[Swell KYC] ${user.name} — documents reçus`,
        htmlBody: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;">
  <div style="background:#b45309;color:white;padding:1.5rem;border-radius:8px 8px 0 0;">
    <div style="font-size:1.25rem;font-weight:700;">📋 Nouveau KYC à vérifier</div>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;padding:1.5rem;background:#fff;">
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:1rem;">
      <tr><td style="padding:4px 0;font-size:14px;color:#374151;"><strong>Nom :</strong></td><td style="padding:4px 0;font-size:14px;color:#111827;">${user.name || '—'}</td></tr>
      <tr><td style="padding:4px 0;font-size:14px;color:#374151;"><strong>Email :</strong></td><td style="padding:4px 0;font-size:14px;"><a href="mailto:${user.email}" style="color:#0077B6;">${user.email || '—'}</a></td></tr>
      <tr><td style="padding:4px 0;font-size:14px;color:#374151;"><strong>Soumis le :</strong></td><td style="padding:4px 0;font-size:14px;color:#111827;">${submittedAt}</td></tr>
    </table>
    <div style="margin-bottom:1rem;">
      <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#374151;">Documents joints :</p>
      <table cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:4px 8px 4px 0;"><img src="${frontUrl}" alt="Recto" style="width:120px;height:80px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;" /></td>
          <td style="padding:4px 0;"><img src="${backUrl}" alt="Verso" style="width:120px;height:80px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;" /></td>
        </tr>
        <tr><td colspan="2" style="padding:4px 0 0;font-size:11px;color:#9ca3af;">Recto</td></tr>
        <tr><td colspan="2" style="padding:2px 0 0;font-size:11px;color:#9ca3af;">Verso</td></tr>
      </table>
    </div>
    <table cellpadding="0" cellspacing="0"><tr><td style="background:#0077B6;border-radius:8px;">
      <a href="${adminLink}" style="color:#fff;text-decoration:none;font-size:15px;font-weight:700;display:block;padding:12px 24px;text-align:center;">Examiner le dossier →</a>
    </td></tr></table>
  </div>
</div>`,
        tag: 'admin-kyc-notification'
      }).catch(err => console.error('[Identity] Admin notification failed:', err.message));
    }

    // Optional Slack notification — silently skip if SLACK_WEBHOOK_URL not set
    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (slackWebhookUrl && adminEmail) {
      fetch(slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `📋 *Nouveau KYC à vérifier*\n*Nom :* ${user.name}\n*Email :* ${user.email}\n*Lien :* ${adminLink}`
        })
      }).catch(() => {}); // non-fatal, no logging for Slack
    }

    res.json({
      success: true,
      status: result.identity_status,
      message: 'Documents reçus. Vérification en cours — délai habituel : quelques heures.'
    });
  } catch (err) {
    if (err.message.includes('Upload')) {
      return res.status(503).json({ error: 'Téléversement temporairement indisponible, réessayez.' });
    }
    console.error('KYC submit error:', err);
    res.status(500).json({ error: 'Erreur lors de la soumission' });
  }
});

// POST /api/identity/admin/approve/:userId — admin approve (protected by ADMIN_SECRET header)
// Side effect: auto-activates any boards the host created before KYC was verified.
router.post('/admin/approve/:userId', async (req, res) => {
  if (req.headers['x-admin-secret'] !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  try {
    const userId = parseInt(req.params.userId);
    const result = await approveIdentity(userId);
    if (!result) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const activatedCount = await activatePendingKycBoards(userId);
    res.json({ success: true, user: result, boards_activated: activatedCount });
  } catch (err) {
    res.status(500).json({ error: 'Erreur approbation' });
  }
});

// POST /api/identity/admin/reject/:userId — admin reject with retry option
router.post('/admin/reject/:userId', async (req, res) => {
  if (req.headers['x-admin-secret'] !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  try {
    const result = await rejectIdentity(parseInt(req.params.userId));
    if (!result) return res.status(404).json({ error: 'Utilisateur introuvable' });
    res.json({ success: true, user: result });
  } catch (err) {
    res.status(500).json({ error: 'Erreur rejet' });
  }
});

module.exports = router;