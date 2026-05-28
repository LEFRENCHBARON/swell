#!/usr/bin/env node
// scripts/activate-brand.js — one-command brand activator.
// Usage: node scripts/activate-brand.js <brand-id> [--new-domain <domain>]
// Example: node scripts/activate-brand.js wavehold --new-domain wavehold.com
//
// What this does:
//   1. Validates the brand exists in public/brand/<id>/
//   2. Copies favicon.svg, favicon-maskable.svg → public/icons/
//   3. Copies og-image.svg → public/og-image.svg
//   4. Copies manifest.json → public/manifest.json (rewrites icon paths to /icons/)
//   5. Patches BASE_URL in routes/seo.js + routes/spot-pages.js
//   6. Patches all "Swell" brand name occurrences in routes/
//   7. Patches public/robots.txt sitemap URL
//   8. Patches sw.js + sw-v3.js cache name
//   9. Prints a summary of what changed — operator reviews before committing.
//
// Does NOT touch: public/index.html, public/app.html, public/host.html
// (those require human review per MIGRATION.md section 2 — mid-sentence copy)
// Does NOT commit automatically — operator commits after review.

'use strict';

const fs = require('fs');
const path = require('path');

// ── Brand definitions (kept in sync with generate-brand-kit.js) ──────────────
const BRANDS = {
  swell:      { name: 'Swell',      domain: 'swell.com',      shortName: 'Swell'      },
  wavehold:   { name: 'Wavehold',   domain: 'wavehold.com',   shortName: 'Wavehold'   },
  tidale:     { name: 'Tidalé',     domain: 'tidale.com',     shortName: 'Tidalé'     },
  surfpal:    { name: 'Surfpal',    domain: 'surfpal.com',    shortName: 'Surfpal'    },
  localboard: { name: 'Localboard', domain: 'localboard.com', shortName: 'Localboard' },
  shackwave:  { name: 'Shackwave',  domain: 'shackwave.com',  shortName: 'Shackwave'  },
};

// ── Parse CLI args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help') {
  console.log('Usage: node scripts/activate-brand.js <brand-id> [--new-domain <domain>]');
  console.log('       node scripts/activate-brand.js wavehold --new-domain wavehold.com');
  console.log('\nAvailable brand IDs:', Object.keys(BRANDS).join(', '));
  process.exit(0);
}

const brandId = args[0];
const domainFlagIdx = args.indexOf('--new-domain');
let newDomain = domainFlagIdx >= 0 ? args[domainFlagIdx + 1] : null;

if (!BRANDS[brandId]) {
  console.error(`❌  Unknown brand ID: "${brandId}"`);
  console.error(`Available: ${Object.keys(BRANDS).join(', ')}`);
  process.exit(1);
}

const brand = BRANDS[brandId];
if (!newDomain) {
  newDomain = brand.domain;
  console.log(`ℹ️  No --new-domain provided. Defaulting to "${newDomain}".`);
  console.log(`   (Pass --new-domain <your-final-domain> once DNS is configured)`);
}

const OLD_URL = 'https://swell.polsia.app';
const OLD_NAME = 'Swell';
const NEW_URL = `https://${newDomain}`;
const NEW_NAME = brand.name;

const BRAND_DIR = path.join(__dirname, '..', 'public', 'brand', brandId);
const ROOT = path.join(__dirname, '..');

// ── Validate brand assets exist ───────────────────────────────────────────────
if (!fs.existsSync(BRAND_DIR)) {
  console.error(`❌  Brand assets not found at ${BRAND_DIR}`);
  console.error('   Run: node scripts/generate-brand-kit.js');
  process.exit(1);
}

const changed = [];

// ── Helper: patch a file with string replacements ─────────────────────────────
function patchFile(filepath, replacements, label) {
  const original = fs.readFileSync(filepath, 'utf8');
  let patched = original;
  for (const [from, to] of replacements) {
    patched = patched.split(from).join(to);
  }
  if (patched !== original) {
    fs.writeFileSync(filepath, patched, 'utf8');
    changed.push(label || filepath);
    return true;
  }
  return false;
}

// ── Helper: copy a file ────────────────────────────────────────────────────────
function copyAsset(src, dest) {
  fs.copyFileSync(src, dest);
  changed.push(`${path.basename(dest)} ← brand/${brandId}/${path.basename(src)}`);
}

console.log(`\n🏄  Activating brand: ${NEW_NAME} (${brandId})`);
console.log(`    Old URL: ${OLD_URL}`);
console.log(`    New URL: ${NEW_URL}\n`);

// ── 1. Copy favicon + maskable icon ───────────────────────────────────────────
const iconsDir = path.join(ROOT, 'public', 'icons');
copyAsset(path.join(BRAND_DIR, 'favicon.svg'), path.join(iconsDir, 'icon.svg'));
copyAsset(path.join(BRAND_DIR, 'favicon-maskable.svg'), path.join(iconsDir, 'icon-maskable.svg'));

// ── 2. Copy OG image ───────────────────────────────────────────────────────────
copyAsset(path.join(BRAND_DIR, 'og-image.svg'), path.join(ROOT, 'public', 'og-image.svg'));

// ── 3. Copy manifest (rewrite icon paths to /icons/ for prod) ─────────────────
const manifestSrc = JSON.parse(fs.readFileSync(path.join(BRAND_DIR, 'manifest.json'), 'utf8'));
manifestSrc.icons = [
  { src: '/icons/icon.svg',          sizes: 'any',     type: 'image/svg+xml', purpose: 'any'      },
  { src: '/icons/icon-maskable.svg', sizes: 'any',     type: 'image/svg+xml', purpose: 'maskable' },
  { src: '/icons/icon-192.png',      sizes: '192x192', type: 'image/png',     purpose: 'any'      },
  { src: '/icons/icon-512.png',      sizes: '512x512', type: 'image/png',     purpose: 'any'      },
];
fs.writeFileSync(path.join(ROOT, 'public', 'manifest.json'), JSON.stringify(manifestSrc, null, 2) + '\n', 'utf8');
changed.push('manifest.json ← brand kit + /icons/ paths');

// ── 4. Patch routes/seo.js ────────────────────────────────────────────────────
patchFile(path.join(ROOT, 'routes', 'seo.js'), [
  [`'${OLD_URL}'`, `'${NEW_URL}'`],
  [`"${OLD_URL}"`, `"${NEW_URL}"`],
  [`'${OLD_NAME}'`, `'${NEW_NAME}'`],
  [`"${OLD_NAME}"`, `"${NEW_NAME}"`],
  [`>${OLD_NAME}<`, `>${NEW_NAME}<`],
  [`| ${OLD_NAME}`, `| ${NEW_NAME}`],
  [`sur ${OLD_NAME}`, `sur ${NEW_NAME}`],
  [`© 2026 ${OLD_NAME}`, `© 2026 ${NEW_NAME}`],
  [`Réserve directement sur ${OLD_NAME}`, `Réserve directement sur ${NEW_NAME}`],
  [`Réserver sur ${OLD_NAME}`, `Réserver sur ${NEW_NAME}`],
  [`${OLD_NAME} — Location`, `${NEW_NAME} — Location`],
], 'routes/seo.js');

// ── 5. Patch routes/spot-pages.js ─────────────────────────────────────────────
patchFile(path.join(ROOT, 'routes', 'spot-pages.js'), [
  [`'${OLD_URL}'`, `'${NEW_URL}'`],
  [`"${OLD_URL}"`, `"${NEW_URL}"`],
  [`| ${OLD_NAME}`, `| ${NEW_NAME}`],
  [`sur ${OLD_NAME}`, `sur ${NEW_NAME}`],
  [`— ${OLD_NAME}`, `— ${NEW_NAME}`],
  [`sur Swell, filtre`, `sur ${NEW_NAME}, filtre`],
  [`Swell filtre`, `${NEW_NAME} filtre`],
  [`Avec Swell`, `Avec ${NEW_NAME}`],
  [`© 2026 ${OLD_NAME}`, `© 2026 ${NEW_NAME}`],
  [`boards Swell sont couvertes`, `boards ${NEW_NAME} sont couvertes`],
  [`reviewer Swell">`, `reviewer ${NEW_NAME}">`],
  [`>${OLD_NAME}<`, `>${NEW_NAME}<`],
  [`"${OLD_NAME}"`, `"${NEW_NAME}"`],
  [`'${OLD_NAME}'`, `'${NEW_NAME}'`],
  [`${OLD_NAME} Shield`, `${NEW_NAME} Shield`],
  [`← Retour à ${OLD_NAME}`, `← Retour à ${NEW_NAME}`],
  [`swell@polsia.app`, `${brandId}@polsia.app`],
  [`instagram.com/swell_surf`, `instagram.com/${brandId}_surf`],
  [`tiktok.com/@swell_surf`, `tiktok.com/@${brandId}_surf`],
  [`Location planches ${OLD_NAME}`, `Location planches ${NEW_NAME}`],
  [`garanti par ${OLD_NAME} Shield`, `garanti par ${NEW_NAME} Shield`],
], 'routes/spot-pages.js');

// ── 6. Patch public/robots.txt ────────────────────────────────────────────────
patchFile(path.join(ROOT, 'public', 'robots.txt'), [
  [`${OLD_URL}/sitemap.xml`, `${NEW_URL}/sitemap.xml`],
], 'public/robots.txt');

// ── 7. Patch service worker cache names ───────────────────────────────────────
for (const swFile of ['sw.js', 'sw-v3.js']) {
  patchFile(path.join(ROOT, 'public', swFile), [
    [`'swell-v3'`, `'${brandId}-v3'`],
    [`"swell-v3"`, `"${brandId}-v3"`],
    [`Service Worker for Swell PWA`, `Service Worker for ${NEW_NAME} PWA`],
  ], `public/${swFile}`);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n✅  Done. ${changed.length} files changed:\n`);
for (const c of changed) console.log(`    • ${c}`);

console.log(`
⚠️   MANUAL STEPS STILL REQUIRED (per MIGRATION.md):
    1. Review mid-sentence copy in: public/index.html, public/app.html,
       public/host.html, public/payment-success.html, public/deposit-success.html
    2. services/email.js → update replyTo email address
    3. Postmark → add new sender signature + DKIM/SPF DNS records
    4. Google Search Console → add new domain property + submit sitemap

📋  Ready to commit:
    git add routes/seo.js routes/spot-pages.js public/robots.txt \\
            public/manifest.json public/og-image.svg public/icons/ \\
            public/sw.js public/sw-v3.js
    git commit -m "feat: activate brand ${NEW_NAME} (${brandId}) — ${NEW_URL}"
`);
