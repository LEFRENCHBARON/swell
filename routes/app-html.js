// Serves app.html with per-request CSP nonce injected into external script tags.
// CSP: script-src uses nonce, no 'unsafe-inline' — removes the inline script risk.
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

router.get('/app.html', (req, res) => {
  const filePath = path.join(__dirname, '..', 'public', 'app.html');
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  let html = fs.readFileSync(filePath, 'utf8');
  const nonce = res.locals.cspNonce;
  // Inject nonce into all <script src="..."> tags
  html = html.replace(/(<script[^>]*src=["'][^"']+["'])/gi, (match) => {
    return match.replace(/(\/?>)$/, ` nonce="${nonce}"$1`);
  });
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: blob:",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join('; '));
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(html);
});

module.exports = router;