// What this module owns: partner registration endpoint and partner landing page serve.
// Does NOT own admin partner management, booking logic, or user auth.
const express = require('express');
const router = express.Router();
const { createPartner } = require('../db/partners');
const { sendTransactionalEmail } = require('../services/email');

const ADMIN_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || 'admin@swell.fr';

async function sendEmail({ to, subject, body, html }) {
  sendTransactionalEmail({ to, subject, htmlBody: html || body, textBody: body })
    .catch(err => console.error('[partners] email send error:', err.message));
}

const TYPE_LABELS = { location: 'Location', ecole: 'École de surf', shaper: 'Shaper' };

// POST /api/partners — submit shop registration form
router.post('/', async (req, res) => {
  const { name, type, location, email, phone, fleet_estimate, website, message } = req.body;

  // Validate required fields
  if (!name || !type || !location || !email || !phone) {
    return res.status(400).json({ error: 'Champs obligatoires manquants (nom, type, ville, email, téléphone).' });
  }
  if (!['location', 'ecole', 'shaper'].includes(type)) {
    return res.status(400).json({ error: 'Type d\'activité invalide.' });
  }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) {
    return res.status(400).json({ error: 'Adresse email invalide.' });
  }

  let partner;
  try {
    partner = await createPartner({
      name: name.trim(),
      type,
      location: location.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      fleet_estimate: fleet_estimate ? parseInt(fleet_estimate, 10) : null,
      website: website ? website.trim() : null,
      message: message ? message.trim() : null,
    });
  } catch (err) {
    console.error('[partners] createPartner error:', err.message);
    return res.status(500).json({ error: 'Erreur serveur. Veuillez réessayer.' });
  }

  // Register contact + send emails async (no await — don't block the response)

  // Confirmation email to shop
  sendEmail({
    to: partner.email,
    subject: 'Bienvenue chez Swell — Demande reçue 🏄',
    body: `Bonjour ${partner.name},\n\nDemande de partenariat Swell bien reçue.\n\nOn revient vers toi sous 48h pour finaliser l'inscription et activer tes planches.\n\nÀ bientôt sur les vagues,\nSwell`,
    html: `
      <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 560px; margin: 0 auto; background: #fafaf8; padding: 40px 32px; border-radius: 16px;">
        <div style="font-family: 'Syne', Arial, sans-serif; font-size: 24px; font-weight: 800; color: #1a1a1a; margin-bottom: 24px;">
          Q<span style="color: #0066aa;">i</span>ver
        </div>
        <h2 style="color: #1a1a1a; font-size: 20px; margin-bottom: 16px;">Demande de partenariat reçue 🤙</h2>
        <p style="color: #444; line-height: 1.7; margin-bottom: 12px;">Bonjour <strong>${partner.name}</strong>,</p>
        <p style="color: #444; line-height: 1.7; margin-bottom: 12px;">
          Demande de partenariat bien reçue. On revient vers toi <strong>sous 48h</strong> pour finaliser.
        </p>
        <p style="color: #444; line-height: 1.7; margin-bottom: 24px;">
          Une fois approuvé : tu listes tes planches, tu suis les locations en temps réel, et tu touches <strong>85% sur chaque loc</strong>.
        </p>
        <div style="background: #f0f7ff; border-left: 3px solid #0066aa; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
          <p style="color: #1a1a1a; font-size: 14px; margin: 0;"><strong>Ta demande :</strong><br>
            Shop : ${partner.name}<br>
            Type : ${TYPE_LABELS[partner.type] || partner.type}<br>
            Ville : ${partner.location}<br>
            ${partner.fleet_estimate ? `Flotte estimée : ${partner.fleet_estimate} planches` : ''}
          </p>
        </div>
        <p style="color: #888; font-size: 14px; margin: 0;">À bientôt 🌊<br><strong>Swell</strong></p>
      </div>
    `,
  });

  // Admin notification
  sendEmail({
    to: ADMIN_EMAIL,
    subject: `[Swell] Nouveau partenaire : ${partner.name} (${partner.location})`,
    body: `Nouveau partenaire inscrit sur Swell.\n\nShop : ${partner.name}\nType : ${TYPE_LABELS[partner.type] || partner.type}\nVille : ${partner.location}\nEmail : ${partner.email}\nTéléphone : ${partner.phone}\nFlotte estimée : ${partner.fleet_estimate || 'Non renseigné'}\nSite : ${partner.website || 'Non renseigné'}\nMessage : ${partner.message || 'Aucun'}\n\nID en base : ${partner.id}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #fff;">
        <h2 style="color: #0066aa;">Nouveau partenaire Swell</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee; color: #666; width: 140px;">Shop</td><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>${partner.name}</strong></td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Type</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${TYPE_LABELS[partner.type] || partner.type}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Ville</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${partner.location}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Email</td><td style="padding: 8px; border-bottom: 1px solid #eee;"><a href="mailto:${partner.email}">${partner.email}</a></td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Téléphone</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${partner.phone}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Flotte</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${partner.fleet_estimate || '—'} planches</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #eee; color: #666;">Site web</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${partner.website ? `<a href="${partner.website}">${partner.website}</a>` : '—'}</td></tr>
          <tr><td style="padding: 8px; color: #666; vertical-align: top;">Message</td><td style="padding: 8px;">${partner.message || '—'}</td></tr>
        </table>
        <p style="font-size: 12px; color: #aaa; margin-top: 16px;">ID base : #${partner.id} — ${new Date(partner.created_at).toLocaleString('fr-FR')}</p>
      </div>
    `,
  });

  res.status(201).json({ success: true, partner: { id: partner.id, name: partner.name } });
});

module.exports = router;
