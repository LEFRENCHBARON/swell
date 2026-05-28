// Serves static HTML pages. Does not own business logic or data access.
const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

router.get('/blog', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'blog', 'index.html'));
});

router.get('/blog/:slug', (req, res) => {
  let slug = req.params.slug;
  if (slug.endsWith('.html')) slug = slug.slice(0, -5);
  const filePath = path.join(__dirname, '..', 'public', 'blog', `${slug}.html`);
  if (fs.existsSync(filePath)) {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(filePath);
  } else {
    res.status(404).redirect('/blog');
  }
});

router.get('/brand-lab', (req, res) => {
  if (req.query.key !== (process.env.BRAND_LAB_KEY || 'swell-lab'))
    return res.status(401).send("Accès restreint — ajoute ?key=... à l'URL.");
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, '..', 'public', 'brand-lab.html'));
});

router.get('/partner', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'partner.html')));
router.get('/press', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'press.html')));
router.get('/host', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'host.html')));
router.get('/cgv', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'cgv.html')));
router.get('/cgu', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'cgv.html')));
router.get('/confidentialite', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'confidentialite.html')));
router.get('/mentions-legales', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'mentions-legales.html')));
router.get('/payment/success', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'payment-success.html')));
router.get('/payment/cancel', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'payment-cancel.html')));

router.get('/unsubscribe', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Se désinscrire — Swell</title>
  <meta name="robots" content="noindex">
</head>
<body style="background:#0e1e36;color:#f0f4f8;font-family:'Space Grotesk',system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:1rem;">
  <div style="max-width:480px;text-align:center;">
    <div style="font-size:2rem;margin-bottom:1rem;">✉️</div>
    <h1 style="font-size:1.5rem;margin-bottom:0.75rem;">Se désinscrire des emails Swell</h1>
    <p style="color:rgba(240,244,248,0.7);margin-bottom:1.5rem;">Pour vous désinscrire de nos communications, envoyez un email à <a href="mailto:hello@swell.fr" style="color:#00c2e0;">hello@swell.fr</a> avec l'objet "Désinscription".</p>
    <p style="color:rgba(240,244,248,0.5);font-size:0.85rem;">Conformément au RGPD, votre demande sera traitée dans un délai de 72h.</p>
    <a href="/" style="display:inline-block;margin-top:1.5rem;color:#00c2e0;text-decoration:none;">← Retour à l'accueil</a>
  </div>
</body>
</html>`);
});

module.exports = router;