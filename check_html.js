const fs = require('fs');
const h = fs.readFileSync('public/app.html', 'utf8');
const need = ['<html', '</html>', '<body', '</body>'];
const missing = need.filter(t => h.indexOf(t) === -1);
if (missing.length) {
  console.error('FAIL: app.html missing tags: ' + missing.join(', '));
  process.exit(1);
}
console.log('PASS: app.html has all required tags');