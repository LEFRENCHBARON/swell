#!/usr/bin/env node
// generate-brand-kit.js — generates all brand asset files for all 6 Swell brand candidates
// Outputs to public/brand/{brand-id}/
// Run: node scripts/generate-brand-kit.js

const fs = require('fs');
const path = require('path');

const BRANDS = [
  {
    id: 'swell',
    name: 'Swell',
    lettermark: 'Q',
    tagline: 'Arrive léger. Surfe local.',
    domain: 'swell.com',
    shortName: 'Swell',
    pwaDesc: 'Trouve la board parfaite qui t\'attend sur place — louée par des surfeurs locaux.',
    colors: {
      primary: '#ff6b35',
      accent: '#1a90d8',
      neutral: '#0e1e36',
      bg: '#09152a',
      surface: '#1c3058',
      textMuted: 'rgba(255,255,255,0.6)',
      text: '#ffffff',
      themeColor: '#09152a',
    },
    fonts: {
      display: "'Syne', sans-serif",
      body: "'DM Sans', sans-serif",
      displayGfonts: 'Syne:wght@700;800',
      bodyGfonts: 'DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600',
    },
    radii: { card: '16px', btn: '100px', input: '10px' },
    shadows: { card: '0 4px 24px rgba(0,0,0,0.4)', btn: '0 6px 24px rgba(255,107,53,0.4)' },
  },
  {
    id: 'wavehold',
    name: 'Wavehold',
    lettermark: 'W',
    tagline: 'Hold the local knowledge.',
    domain: 'wavehold.com',
    shortName: 'Wavehold',
    pwaDesc: 'Rent surfboards directly from local surfers. No shop queues.',
    colors: {
      primary: '#0ec6a2',
      accent: '#005f6b',
      neutral: '#0a1612',
      bg: '#060e0b',
      surface: '#0f2820',
      textMuted: 'rgba(255,255,255,0.55)',
      text: '#ffffff',
      themeColor: '#060e0b',
    },
    fonts: {
      display: "'Plus Jakarta Sans', sans-serif",
      body: "'Space Grotesk', sans-serif",
      displayGfonts: 'Plus+Jakarta+Sans:wght@600;700;800',
      bodyGfonts: 'Space+Grotesk:wght@400;500;600',
    },
    radii: { card: '12px', btn: '8px', input: '8px' },
    shadows: { card: '0 2px 16px rgba(0,0,0,0.5)', btn: '0 4px 20px rgba(14,198,162,0.35)' },
  },
  {
    id: 'tidale',
    name: 'Tidalé',
    lettermark: 'T',
    tagline: 'La planche qui t\'attendait.',
    domain: 'tidale.com',
    shortName: 'Tidalé',
    pwaDesc: 'Surfeurs locaux. Boards authentiques. Vagues vraies.',
    colors: {
      primary: '#d4a574',
      accent: '#4a90a4',
      neutral: '#12100e',
      bg: '#0c0b09',
      surface: '#211e1a',
      textMuted: 'rgba(255,255,255,0.58)',
      text: '#ffffff',
      themeColor: '#0c0b09',
    },
    fonts: {
      display: "'Playfair Display', serif",
      body: "'DM Sans', sans-serif",
      displayGfonts: 'Playfair+Display:wght@700;800',
      bodyGfonts: 'DM+Sans:opsz,wght@9..40,400;9..40,500',
    },
    radii: { card: '20px', btn: '6px', input: '8px' },
    shadows: { card: '0 6px 32px rgba(0,0,0,0.6)', btn: '0 4px 16px rgba(212,165,116,0.3)' },
  },
  {
    id: 'surfpal',
    name: 'Surfpal',
    lettermark: 'S',
    tagline: 'Le copain qui a des planches.',
    domain: 'surfpal.com',
    shortName: 'Surfpal',
    pwaDesc: 'Des surfeurs locaux partagent leurs boards. Simple, direct, entre passionnés.',
    colors: {
      primary: '#f7b731',
      accent: '#2ecc71',
      neutral: '#161a10',
      bg: '#0e1109',
      surface: '#1e2414',
      textMuted: 'rgba(255,255,255,0.58)',
      text: '#ffffff',
      themeColor: '#0e1109',
    },
    fonts: {
      display: "'Outfit', sans-serif",
      body: "'DM Sans', sans-serif",
      displayGfonts: 'Outfit:wght@400;600;700;800',
      bodyGfonts: 'DM+Sans:opsz,wght@9..40,400;9..40,500',
    },
    radii: { card: '20px', btn: '100px', input: '12px' },
    shadows: { card: '0 4px 20px rgba(0,0,0,0.4)', btn: '0 6px 20px rgba(247,183,49,0.4)' },
  },
  {
    id: 'localboard',
    name: 'Localboard',
    lettermark: 'L',
    tagline: 'Every board is already there.',
    domain: 'localboard.com',
    shortName: 'Localboard',
    pwaDesc: 'Rent boards from local surfers who ride these exact waves.',
    colors: {
      primary: '#3d7eff',
      accent: '#ff4757',
      neutral: '#0f0f14',
      bg: '#08080f',
      surface: '#16162a',
      textMuted: 'rgba(255,255,255,0.55)',
      text: '#ffffff',
      themeColor: '#08080f',
    },
    fonts: {
      display: "'Space Grotesk', sans-serif",
      body: "'DM Sans', sans-serif",
      displayGfonts: 'Space+Grotesk:wght@600;700',
      bodyGfonts: 'DM+Sans:opsz,wght@9..40,400;9..40,500',
    },
    radii: { card: '10px', btn: '6px', input: '6px' },
    shadows: { card: '0 2px 12px rgba(0,0,0,0.6)', btn: '0 4px 16px rgba(61,126,255,0.4)' },
  },
  {
    id: 'shackwave',
    name: 'Shackwave',
    lettermark: 'S',
    tagline: 'Real boards. Real surfers.',
    domain: 'shackwave.com',
    shortName: 'Shackwave',
    pwaDesc: 'Real boards from real surfers. No shop markup.',
    colors: {
      primary: '#ff2d55',
      accent: '#ff9f0a',
      neutral: '#0a0a0a',
      bg: '#060606',
      surface: '#141414',
      textMuted: 'rgba(255,255,255,0.5)',
      text: '#ffffff',
      themeColor: '#060606',
    },
    fonts: {
      display: "'Syne', sans-serif",
      body: "'Space Grotesk', sans-serif",
      displayGfonts: 'Syne:wght@700;800',
      bodyGfonts: 'Space+Grotesk:wght@400;500;600',
    },
    radii: { card: '8px', btn: '4px', input: '4px' },
    shadows: { card: '0 4px 20px rgba(0,0,0,0.7)', btn: '0 4px 20px rgba(255,45,85,0.45)' },
  },
];

const OUT_DIR = path.join(__dirname, '..', 'public', 'brand');

// ── Helpers ──────────────────────────────────────────────────────────────────

function writeFile(filepath, content) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, content, 'utf8');
}

// ── Logo SVG mark (geometric surfboard-inspired icon) ───────────────────────
function logoMarkSvg(b, variant = 'light') {
  const bg = variant === 'dark' ? b.colors.bg : 'none';
  const fill = variant === 'mono-white' ? '#ffffff'
             : variant === 'mono-black' ? '#000000'
             : b.colors.primary;
  const stroke = variant === 'mono-white' ? 'rgba(255,255,255,0.3)'
               : variant === 'mono-black' ? 'rgba(0,0,0,0.15)'
               : b.colors.accent;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  ${bg !== 'none' ? `<rect width="64" height="64" rx="14" fill="${bg}"/>` : ''}
  <!-- Surfboard icon — narrow ellipse tilted 30deg, fin at bottom -->
  <g transform="translate(32,32)">
    <!-- Board body -->
    <ellipse cx="0" cy="-4" rx="10" ry="22"
      transform="rotate(-15)"
      fill="${fill}" opacity="0.95"/>
    <!-- Fin -->
    <path d="M6 14 Q10 22 4 22 Q3 18 6 14Z"
      transform="rotate(-15)"
      fill="${fill}" opacity="0.7"/>
    <!-- Accent stripe -->
    <ellipse cx="0" cy="-4" rx="4" ry="10"
      transform="rotate(-15)"
      fill="${stroke}" opacity="0.4"/>
  </g>
</svg>`;
}

// ── Wordmark SVG ─────────────────────────────────────────────────────────────
function wordmarkSvg(b, variant = 'light') {
  const textColor = variant === 'mono-black' ? '#000000' : '#ffffff';
  const accentColor = variant === 'mono-black' ? '#333333'
                    : variant === 'mono-white' ? 'rgba(255,255,255,0.55)'
                    : b.colors.primary;
  const nameUpper = b.id === 'shackwave' ? b.name.toUpperCase() : b.name;
  const width = Math.max(nameUpper.length * 28, 160);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 48" width="${width}" height="48">
  <text x="0" y="36"
    font-family="system-ui, sans-serif"
    font-size="36" font-weight="800"
    fill="${textColor}" letter-spacing="-1">${nameUpper.slice(0, -3)}<tspan fill="${accentColor}">${nameUpper.slice(-3)}</tspan></text>
</svg>`;
}

// ── Lockup: mark + wordmark horizontal ──────────────────────────────────────
function lockupHorizontalSvg(b, variant = 'light') {
  const textColor = variant === 'mono-black' ? '#000000' : '#ffffff';
  const accentColor = variant === 'mono-black' ? '#333333'
                    : variant === 'mono-white' ? 'rgba(255,255,255,0.55)'
                    : b.colors.primary;
  const markFill = variant === 'mono-white' ? '#ffffff'
                 : variant === 'mono-black' ? '#000000'
                 : b.colors.primary;
  const markStroke = variant === 'mono-white' ? 'rgba(255,255,255,0.3)'
                   : variant === 'mono-black' ? 'rgba(0,0,0,0.15)'
                   : b.colors.accent;
  const nameUpper = b.id === 'shackwave' ? b.name.toUpperCase() : b.name;
  const totalW = 56 + nameUpper.length * 18 + 16;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} 48" width="${totalW}" height="48">
  <!-- Mark (32x32 centered in 48h) -->
  <g transform="translate(8,8)">
    <g transform="translate(16,16)">
      <ellipse cx="0" cy="-3" rx="6" ry="13" transform="rotate(-15)" fill="${markFill}" opacity="0.95"/>
      <path d="M3.5 8 Q6 13 2.5 13 Q2 11 3.5 8Z" transform="rotate(-15)" fill="${markFill}" opacity="0.7"/>
      <ellipse cx="0" cy="-3" rx="2.5" ry="6" transform="rotate(-15)" fill="${markStroke}" opacity="0.4"/>
    </g>
  </g>
  <!-- Wordmark -->
  <text x="52" y="34" font-family="system-ui, sans-serif" font-size="28" font-weight="800" fill="${textColor}" letter-spacing="-0.5">
    ${nameUpper.slice(0, -3)}<tspan fill="${accentColor}">${nameUpper.slice(-3)}</tspan>
  </text>
</svg>`;
}

// ── Lockup vertical ──────────────────────────────────────────────────────────
function lockupVerticalSvg(b, variant = 'light') {
  const textColor = variant === 'mono-black' ? '#000000' : '#ffffff';
  const accentColor = variant === 'mono-black' ? '#333333'
                    : variant === 'mono-white' ? 'rgba(255,255,255,0.55)'
                    : b.colors.primary;
  const markFill = variant === 'mono-white' ? '#ffffff'
                 : variant === 'mono-black' ? '#000000'
                 : b.colors.primary;
  const markStroke = variant === 'mono-white' ? 'rgba(255,255,255,0.3)'
                   : variant === 'mono-black' ? 'rgba(0,0,0,0.15)'
                   : b.colors.accent;
  const nameUpper = b.id === 'shackwave' ? b.name.toUpperCase() : b.name;
  const nameW = Math.max(nameUpper.length * 18, 80);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${nameW} 100" width="${nameW}" height="100">
  <!-- Mark centered -->
  <g transform="translate(${nameW / 2 - 16},4)">
    <g transform="translate(16,16)">
      <ellipse cx="0" cy="-3" rx="6" ry="13" transform="rotate(-15)" fill="${markFill}" opacity="0.95"/>
      <path d="M3.5 8 Q6 13 2.5 13 Q2 11 3.5 8Z" transform="rotate(-15)" fill="${markFill}" opacity="0.7"/>
      <ellipse cx="0" cy="-3" rx="2.5" ry="6" transform="rotate(-15)" fill="${markStroke}" opacity="0.4"/>
    </g>
  </g>
  <!-- Wordmark -->
  <text x="${nameW / 2}" y="82" text-anchor="middle"
    font-family="system-ui, sans-serif" font-size="24" font-weight="800"
    fill="${textColor}" letter-spacing="-0.5">
    ${nameUpper.slice(0, -3)}<tspan fill="${accentColor}">${nameUpper.slice(-3)}</tspan>
  </text>
</svg>`;
}

// ── Favicon SVG (32×32) ──────────────────────────────────────────────────────
function faviconSvg(b) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="7" fill="${b.colors.bg}"/>
  <g transform="translate(16,16)">
    <ellipse cx="0" cy="-2" rx="5" ry="11" transform="rotate(-15)" fill="${b.colors.primary}"/>
    <path d="M3 6 Q5 11 2 11 Q1.5 9 3 6Z" transform="rotate(-15)" fill="${b.colors.primary}" opacity="0.7"/>
    <ellipse cx="0" cy="-2" rx="2" ry="5" transform="rotate(-15)" fill="${b.colors.accent}" opacity="0.5"/>
  </g>
</svg>`;
}

// ── Maskable favicon (safe-zone centered, 512×512) ───────────────────────────
function faviconMaskableSvg(b) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="${b.colors.bg}"/>
  <!-- Radial glow -->
  <radialGradient id="glow" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="${b.colors.primary}" stop-opacity="0.25"/>
    <stop offset="100%" stop-color="${b.colors.bg}" stop-opacity="0"/>
  </radialGradient>
  <rect width="512" height="512" fill="url(#glow)"/>
  <!-- Safe zone: 80px padding → mark in center 352×352 area, scaled up -->
  <g transform="translate(256,256)">
    <ellipse cx="0" cy="-30" rx="55" ry="125" transform="rotate(-15)" fill="${b.colors.primary}"/>
    <path d="M32 70 Q60 120 22 120 Q16 100 32 70Z" transform="rotate(-15)" fill="${b.colors.primary}" opacity="0.75"/>
    <ellipse cx="0" cy="-30" rx="22" ry="55" transform="rotate(-15)" fill="${b.colors.accent}" opacity="0.45"/>
  </g>
</svg>`;
}

// ── OG Image 1200×630 ────────────────────────────────────────────────────────
function ogImageSvg(b, spotName = null) {
  const title = spotName ? `${b.name} @ ${spotName}` : b.name;
  const subtitle = spotName
    ? `Location de planches à ${spotName}`
    : b.tagline;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${b.colors.neutral}"/>
      <stop offset="100%" stop-color="${b.colors.bg}"/>
    </linearGradient>
    <radialGradient id="glow1" cx="20%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${b.colors.primary}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="transparent" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="80%" cy="50%" r="40%">
      <stop offset="0%" stop-color="${b.colors.accent}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="transparent" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow1)"/>
  <rect width="1200" height="630" fill="url(#glow2)"/>

  <!-- Wave shapes -->
  <path d="M0 500 Q200 440 350 470 Q500 500 620 440 Q740 380 880 420 Q1020 460 1200 400 L1200 630 L0 630Z"
    fill="${b.colors.accent}" opacity="0.12"/>
  <path d="M0 540 Q300 490 480 520 Q660 550 800 490 Q940 430 1100 470 L1200 450 L1200 630 L0 630Z"
    fill="${b.colors.primary}" opacity="0.08"/>

  <!-- Mark (top-left) -->
  <g transform="translate(80,80)">
    <rect width="64" height="64" rx="14" fill="${b.colors.primary}" opacity="0.15"/>
    <g transform="translate(32,32)">
      <ellipse cx="0" cy="-4" rx="9" ry="20" transform="rotate(-15)" fill="${b.colors.primary}"/>
      <path d="M5 12 Q9 20 3.5 20 Q3 17 5 12Z" transform="rotate(-15)" fill="${b.colors.primary}" opacity="0.7"/>
      <ellipse cx="0" cy="-4" rx="3.5" ry="9" transform="rotate(-15)" fill="${b.colors.accent}" opacity="0.5"/>
    </g>
  </g>

  <!-- Brand name -->
  <text x="165" y="126"
    font-family="system-ui, -apple-system, sans-serif"
    font-size="36" font-weight="800" fill="${b.colors.primary}"
    letter-spacing="-0.5">${b.name}</text>

  <!-- Main title -->
  <text x="80" y="300"
    font-family="system-ui, -apple-system, sans-serif"
    font-size="72" font-weight="800" fill="#ffffff"
    letter-spacing="-2">${title}</text>

  <!-- Subtitle -->
  <text x="80" y="368"
    font-family="system-ui, -apple-system, sans-serif"
    font-size="32" font-weight="400" fill="${b.colors.primary}"
    opacity="0.9">${subtitle}</text>

  <!-- URL pill bottom right -->
  <rect x="880" y="560" width="240" height="44" rx="22" fill="${b.colors.primary}" opacity="0.18"/>
  <text x="1000" y="587" text-anchor="middle"
    font-family="system-ui, sans-serif"
    font-size="20" font-weight="600" fill="${b.colors.primary}">${b.domain}</text>
</svg>`;
}

// ── PWA Manifest ─────────────────────────────────────────────────────────────
function manifestJson(b) {
  return JSON.stringify({
    name: `${b.name} — Location de planches entre surfeurs`,
    short_name: b.shortName,
    description: b.pwaDesc,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    theme_color: b.colors.themeColor,
    background_color: b.colors.themeColor,
    lang: 'fr',
    categories: ['sports', 'lifestyle'],
    icons: [
      { src: `/brand/${b.id}/favicon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: `/brand/${b.id}/favicon-maskable.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
      { src: `/icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `/icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }, null, 2);
}

// ── CSS tokens ───────────────────────────────────────────────────────────────
function tokensCss(b) {
  return `/* ${b.name} brand tokens — generated by scripts/generate-brand-kit.js
   Import this file INSTEAD OF the current :root block in your main CSS.
   Usage: <link rel="stylesheet" href="/brand/${b.id}/tokens.css">
*/
:root {
  /* ── Colors ── */
  --color-primary:      ${b.colors.primary};
  --color-accent:       ${b.colors.accent};
  --color-neutral:      ${b.colors.neutral};
  --color-bg:           ${b.colors.bg};
  --color-surface:      ${b.colors.surface};
  --color-text:         ${b.colors.text};
  --color-text-muted:   ${b.colors.textMuted};
  --color-theme:        ${b.colors.themeColor};

  /* ── Typography ── */
  --font-display:       ${b.fonts.display};
  --font-body:          ${b.fonts.body};

  /* ── Radii ── */
  --radius-card:        ${b.radii.card};
  --radius-btn:         ${b.radii.btn};
  --radius-input:       ${b.radii.input};

  /* ── Shadows ── */
  --shadow-card:        ${b.shadows.card};
  --shadow-btn:         ${b.shadows.btn};

  /* ── Google Fonts URL ── */
  /* https://fonts.googleapis.com/css2?family=${b.fonts.displayGfonts}&family=${b.fonts.bodyGfonts}&display=swap */
}
`;
}

// ── Email header HTML ─────────────────────────────────────────────────────────
function emailHeaderHtml(b) {
  return `<!-- Postmark email header template — ${b.name}
     Drop this block at the top of every transactional email template.
     Replace {{booking_url}} and {{booking_status}} per template. -->
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${b.name}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation"
          style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">

          <!-- HEADER BAND -->
          <tr>
            <td style="background:${b.colors.neutral};padding:24px 32px;text-align:left;">
              <span style="font-family:-apple-system,sans-serif;font-size:22px;font-weight:800;
                color:${b.colors.primary};letter-spacing:-0.5px;">${b.name}</span>
              <span style="display:block;font-size:11px;font-weight:500;color:rgba(255,255,255,0.45);
                letter-spacing:0.12em;text-transform:uppercase;margin-top:4px;">${b.tagline}</span>
            </td>
          </tr>

          <!-- BODY SLOT — replace with actual content per template -->
          <tr>
            <td style="padding:36px 32px;">
              <p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1a1a2e;">
                <!-- CONTENT HERE -->
              </p>
              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0" role="presentation" style="margin-top:28px;">
                <tr>
                  <td style="background:${b.colors.primary};border-radius:100px;padding:14px 28px;">
                    <a href="{{booking_url}}"
                      style="color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">
                      Voir ma réservation →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- FOOTER BAND -->
          <tr>
            <td style="background:#f8f9fa;border-top:1px solid #e9ecef;padding:20px 32px;">
              <p style="margin:0;font-size:12px;color:#868e96;line-height:1.5;">
                Tu reçois cet email car tu as une réservation active sur ${b.name}.<br>
                <a href="{{unsubscribe_url}}" style="color:${b.colors.primary};">Se désinscrire</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

// ── Main generation ───────────────────────────────────────────────────────────
console.log('Generating brand kit assets...\n');

for (const b of BRANDS) {
  const dir = path.join(OUT_DIR, b.id);
  fs.mkdirSync(dir, { recursive: true });

  // Logo marks
  writeFile(path.join(dir, 'logo-mark-light.svg'), logoMarkSvg(b, 'light'));
  writeFile(path.join(dir, 'logo-mark-dark.svg'), logoMarkSvg(b, 'dark'));
  writeFile(path.join(dir, 'logo-mark-mono-white.svg'), logoMarkSvg(b, 'mono-white'));
  writeFile(path.join(dir, 'logo-mark-mono-black.svg'), logoMarkSvg(b, 'mono-black'));

  // Wordmarks
  writeFile(path.join(dir, 'wordmark-light.svg'), wordmarkSvg(b, 'light'));
  writeFile(path.join(dir, 'wordmark-dark.svg'), wordmarkSvg(b, 'mono-black'));

  // Lockups
  writeFile(path.join(dir, 'lockup-horizontal-light.svg'), lockupHorizontalSvg(b, 'light'));
  writeFile(path.join(dir, 'lockup-horizontal-dark.svg'), lockupHorizontalSvg(b, 'dark'));
  writeFile(path.join(dir, 'lockup-vertical-light.svg'), lockupVerticalSvg(b, 'light'));
  writeFile(path.join(dir, 'lockup-vertical-dark.svg'), lockupVerticalSvg(b, 'dark'));

  // Favicons
  writeFile(path.join(dir, 'favicon.svg'), faviconSvg(b));
  writeFile(path.join(dir, 'favicon-maskable.svg'), faviconMaskableSvg(b));

  // OG images
  writeFile(path.join(dir, 'og-image.svg'), ogImageSvg(b));
  writeFile(path.join(dir, 'og-image-hossegor.svg'), ogImageSvg(b, 'Hossegor'));
  writeFile(path.join(dir, 'og-image-graviere.svg'), ogImageSvg(b, 'La Gravière'));

  // Manifest
  writeFile(path.join(dir, 'manifest.json'), manifestJson(b));

  // CSS tokens
  writeFile(path.join(dir, 'tokens.css'), tokensCss(b));

  // Email header
  writeFile(path.join(dir, 'email-header.html'), emailHeaderHtml(b));

  console.log(`  ✓ ${b.name} (${b.id}) — 18 assets`);
}

// ── tokens.css (all brands, pick one via comment) ────────────────────────────
const allTokens = BRANDS.map(b => `
/* ═══════════════════════════════════════════════════════════════
   BRAND: ${b.name.toUpperCase()} — id: ${b.id}
   Uncomment this block and delete the rest to activate this brand.
   ═══════════════════════════════════════════════════════════════ */
/*
${tokensCss(b)}
*/`).join('\n');

writeFile(path.join(OUT_DIR, 'tokens.css'),
`/* Swell brand tokens — all 6 candidates
   USAGE: uncomment one block below to activate a brand.
   In production, replace all :root CSS variables in app.html / index.html
   with the token names defined here.

   Generated: ${new Date().toISOString().slice(0, 10)}
   Regenerate: node scripts/generate-brand-kit.js
*/

/* ── ACTIVE BRAND: SWELL (current) ─────────────────────────── */
:root {
  --color-primary:      #ff6b35;
  --color-accent:       #1a90d8;
  --color-neutral:      #0e1e36;
  --color-bg:           #09152a;
  --color-surface:      #1c3058;
  --color-text:         #ffffff;
  --color-text-muted:   rgba(255,255,255,0.6);
  --color-theme:        #09152a;
  --font-display:       'Syne', sans-serif;
  --font-body:          'DM Sans', sans-serif;
  --radius-card:        16px;
  --radius-btn:         100px;
  --radius-input:       10px;
  --shadow-card:        0 4px 24px rgba(0,0,0,0.4);
  --shadow-btn:         0 6px 24px rgba(255,107,53,0.4);
}

${allTokens}
`);

console.log(`\n  ✓ tokens.css (all brands)\n`);
console.log(`Done. Assets in public/brand/\n`);
console.log(`To activate a brand:\n  1. Run: node scripts/generate-brand-kit.js\n  2. Copy desired brand tokens from public/brand/<id>/tokens.css into your :root\n  3. Update manifest.json, favicon.svg, og-image.svg in /public/\n  4. Follow MIGRATION.md\n`);
