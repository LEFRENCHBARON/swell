/**
 * Injects PWA meta tags + SW registration into all HTML files.
 * Run once during development; changes are committed. Not a build step.
 */
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');

const PWA_HEAD_TAGS = `
    <!-- PWA -->
    <link rel="manifest" href="/manifest.json">
    <meta name="theme-color" content="#060d1a">
    <link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
    <link rel="apple-touch-icon" href="/icons/icon-192.png">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`;

const SW_SCRIPT = `
<script>
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
</script>`;

function findHTMLFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findHTMLFiles(full));
    } else if (entry.name.endsWith('.html') && entry.name !== 'offline.html') {
      files.push(full);
    }
  }
  return files;
}

const htmlFiles = findHTMLFiles(PUBLIC);

for (const file of htmlFiles) {
  let html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(PUBLIC, file);

  // Skip if already has manifest link
  if (html.includes('manifest.json')) {
    console.log(`  SKIP ${rel} (already has manifest)`);
    continue;
  }

  // Inject PWA head tags after viewport meta
  const viewportRe = /<meta\s+name="viewport"[^>]*>/;
  if (viewportRe.test(html)) {
    html = html.replace(viewportRe, (match) => match + PWA_HEAD_TAGS);
  } else {
    // Fallback: inject after charset
    html = html.replace(/<meta\s+charset="[^"]*">/i, (match) => match + PWA_HEAD_TAGS);
  }

  // Inject SW registration before </body>
  if (!html.includes('serviceWorker')) {
    html = html.replace('</body>', SW_SCRIPT + '\n</body>');
  }

  fs.writeFileSync(file, html);
  console.log(`  OK   ${rel}`);
}

console.log(`\nDone. Injected PWA tags into ${htmlFiles.length} files.`);
