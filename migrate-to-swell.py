#!/usr/bin/env python3
"""
migrate-to-swell.py
Migration script: Qiver → Swell
- Email:    Polsia proxy  →  Resend SDK
- Photos:   Polsia R2     →  Cloudinary SDK
- Payments: Polsia API    →  Direct Stripe SDK
- Rename:   Qiver/qiver/QIVER → Swell/swell/SWELL everywhere
"""

import os
import re
import json
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def read(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def write(path, content):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"  ✓ written: {os.path.relpath(path, ROOT)}")

def replace_in_file(path, replacements):
    """Apply a list of (old, new) string replacements to a file."""
    content = read(path)
    original = content
    for old, new in replacements:
        content = content.replace(old, new)
    if content != original:
        write(path, content)
        return True
    return False

TEXT_EXTENSIONS = {
    '.js', '.json', '.html', '.css', '.md', '.txt', '.toml',
    '.yaml', '.yml', '.sql', '.sh', '.env', '.py'
}

SKIP_DIRS = {'.git', 'node_modules', 'icons', '__pycache__', '.nyc_output'}

def all_text_files():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        # Prune ignored dirs in-place
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fname in filenames:
            ext = os.path.splitext(fname)[1].lower()
            if ext in TEXT_EXTENSIONS or fname in ('.gitignore', '.npmrc', '.nvmrc', 'Procfile', 'Makefile'):
                yield os.path.join(dirpath, fname)

# ─────────────────────────────────────────────────────────────────────────────
# Step 1 — Global text substitutions (Qiver → Swell)
# ─────────────────────────────────────────────────────────────────────────────

def step_global_rename():
    print("\n[1/5] Global rename: Qiver → Swell")

    # Order matters: do longest/most-specific patterns first
    substitutions = [
        # Brand name variations
        ("QIVER_GENOME",         "SWELL_GENOME"),
        ("QIVER_EVENT_STORE",    "SWELL_EVENT_STORE"),
        ("QIVER_FAILURE_ATLAS",  "SWELL_FAILURE_ATLAS"),
        ("QIVER_OPERATING",      "SWELL_OPERATING"),
        ("qiver_sid",            "swell_sid"),
        ("qiver.fr",             "swell.fr"),
        ("qiver.polsia.app",     "swell.polsia.app"),
        # Visible brand name (case-preserving)
        ("Qiver Shield",         "Swell Shield"),
        ("Qiver",                "Swell"),
        ("QIVER",                "SWELL"),
        ("qiver",                "swell"),
        # package.json name field handled separately
    ]

    skip_this_script = os.path.abspath(__file__)
    changed = 0

    for fpath in all_text_files():
        if os.path.abspath(fpath) == skip_this_script:
            continue
        try:
            original = read(fpath)
            content = original
            for old, new in substitutions:
                content = content.replace(old, new)
            if content != original:
                write(fpath, content)
                changed += 1
        except Exception as e:
            print(f"  ! skip {fpath}: {e}")

    print(f"  → {changed} files updated")

# ─────────────────────────────────────────────────────────────────────────────
# Step 2 — services/email.js  →  Resend SDK
# ─────────────────────────────────────────────────────────────────────────────

EMAIL_JS = os.path.join(ROOT, 'services', 'email.js')

NEW_EMAIL_JS = '''\
// What this module owns: transactional email sending via Resend.
// Does NOT own email templates, campaign logic, or subscriber management.
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendTransactionalEmail({ to, subject, htmlBody, textBody, tag, replyTo }) {
  const { data, error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || 'Swell <noreply@swell.fr>',
    to,
    subject,
    html: htmlBody,
    text: textBody || '',
    reply_to: replyTo || 'contact@swell.fr',
    tags: tag ? [{ name: 'category', value: tag }] : undefined,
  });

  if (error) {
    throw new Error(`Email send failed: ${JSON.stringify(error)}`);
  }

  return data;
}

module.exports = { sendTransactionalEmail };
'''

def step_email():
    print("\n[2/5] Rewrite services/email.js → Resend SDK")
    write(EMAIL_JS, NEW_EMAIL_JS)

# ─────────────────────────────────────────────────────────────────────────────
# Step 3 — Photo upload functions  →  Cloudinary SDK
# ─────────────────────────────────────────────────────────────────────────────

# Shared Cloudinary helper — injected at the top of each route file that uploads
CLOUDINARY_HELPER = '''\
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
'''

def inject_cloudinary(content, remove_old_imports=True):
    """Inject Cloudinary helper after existing require lines, removing old R2/Polsia imports."""
    if remove_old_imports:
        # Remove node-fetch and form-data imports (only if used for R2)
        content = re.sub(r"^const fetch\s*=\s*require\('node-fetch'\);\n", '', content, flags=re.MULTILINE)
        content = re.sub(r"^const FormData\s*=\s*require\('form-data'\);\n", '', content, flags=re.MULTILINE)

    # Remove old Polsia R2 constants
    content = re.sub(r"^const POLSIA_API_KEY\s*=.*\n", '', content, flags=re.MULTILINE)
    content = re.sub(r"^const R2_URL\s*=.*\n", '', content, flags=re.MULTILINE)

    # Insert Cloudinary helper after the last top-level require line
    lines = content.split('\n')
    last_require_idx = -1
    for i, line in enumerate(lines):
        if re.match(r'^const \w', line) and ("require(" in line or line.strip().startswith('const ')):
            last_require_idx = i
        if line.strip().startswith('function ') or line.strip().startswith('router.') or line.strip().startswith('const router'):
            break

    # Find better insert point: after all top-level const/require blocks
    insert_idx = 0
    for i, line in enumerate(lines):
        if re.match(r"^const .* = require", line) or re.match(r"^const .* = process\.env", line):
            insert_idx = i + 1

    lines.insert(insert_idx, '\n' + CLOUDINARY_HELPER)
    return '\n'.join(lines)


def rewrite_boards_upload(content):
    """Replace uploadPhoto() in routes/boards.js."""
    old = r'''// Upload image to R2 and return URL
async function uploadPhoto\(fileBuffer, filename, mimetype\) \{
  const formData = new FormData\(\);
  formData\.append\('file', fileBuffer, \{ filename, contentType: mimetype \}\);

  const response = await fetch\('https://polsia\.com/api/proxy/r2/upload', \{
    method: 'POST',
    headers: \{
      Authorization: `Bearer \$\{process\.env\.POLSIA_API_KEY\}`,
      \.\.\.formData\.getHeaders\(\)
    \},
    body: formData
  \}\);

  const result = await response\.json\(\);
  if \(!result\.success\) throw new Error\(result\.error\?\.message \|\| 'Upload failed'\);
  return result\.file\.url;
\}'''

    new = '''\
async function uploadPhoto(fileBuffer, _filename, _mimetype) {
  return uploadToCloudinary(fileBuffer, 'swell/boards');
}'''

    return re.sub(old, new, content, flags=re.DOTALL)


def rewrite_profiles_upload(content):
    """Replace uploadAvatar() in routes/profiles.js."""
    old = r'''async function uploadAvatar\(buffer, filename, mimetype\) \{
  const formData = new FormData\(\);
  formData\.append\('file', buffer, \{ filename, contentType: mimetype \}\);
  const response = await fetch\('https://polsia\.com/api/proxy/r2/upload', \{
    method: 'POST',
    headers: \{ Authorization: `Bearer \$\{process\.env\.POLSIA_API_KEY\}`, \.\.\.formData\.getHeaders\(\) \},
    body: formData
  \}\);
  const result = await response\.json\(\);
  if \(!result\.success\) throw new Error\('Avatar upload failed'\);
  return result\.file\.url;
\}'''

    new = '''\
async function uploadAvatar(buffer, _filename, _mimetype) {
  return uploadToCloudinary(buffer, 'swell/avatars');
}'''

    return re.sub(old, new, content, flags=re.DOTALL)


def rewrite_identity_upload(content):
    """Replace uploadDocToR2() in routes/identity.js."""
    old = r'''// Upload to R2 via Polsia proxy
async function uploadDocToR2\(buffer, filename, mimetype\) \{
  const formData = new FormData\(\);
  formData\.append\('file', buffer, \{ filename, contentType: mimetype \}\);
  const response = await fetch\('https://polsia\.com/api/proxy/r2/upload', \{
    method: 'POST',
    headers: \{ Authorization: `Bearer \$\{process\.env\.POLSIA_API_KEY\}`, \.\.\.formData\.getHeaders\(\) \},
    body: formData
  \}\);
  const result = await response\.json\(\);
  if \(!result\.success\) throw new Error\('Upload document échoué'\);
  return result\.file\.url;
\}'''

    new = '''\
async function uploadDocToR2(buffer, _filename, _mimetype) {
  return uploadToCloudinary(buffer, 'swell/identity');
}'''

    return re.sub(old, new, content, flags=re.DOTALL)


def rewrite_inspections_upload(content):
    """Replace uploadToR2() in routes/inspections.js."""
    old = r'''// Upload a single file buffer to R2 and return CDN URL
async function uploadToR2\(buffer, originalname, mimetype\) \{
  const formData = new FormData\(\);
  formData\.append\('file', buffer, \{
    filename: originalname \|\| 'inspection\.jpg',
    contentType: mimetype \|\| 'image/jpeg',
  \}\);

  const response = await fetch\(R2_URL, \{
    method: 'POST',
    headers: \{
      Authorization: `Bearer \$\{POLSIA_API_KEY\}`,
      \.\.\.formData\.getHeaders\(\),
    \},
    body: formData,
  \}\);

  if \(!response\.ok\) \{
    const text = await response\.text\(\);
    throw new Error\(`R2 upload failed: \$\{text\}`\);
  \}
  const result = await response\.json\(\);
  if \(!result\.success\) throw new Error\(result\.error\?\.message \|\| 'Upload échoué'\);
  return result\.file\.url;
\}'''

    new = '''\
async function uploadToR2(buffer, _originalname, _mimetype) {
  return uploadToCloudinary(buffer, 'swell/inspections');
}'''

    return re.sub(old, new, content, flags=re.DOTALL)


def step_photos():
    print("\n[3/5] Replace R2/Polsia photo uploads → Cloudinary")

    files_and_rewrites = [
        ('routes/boards.js',      rewrite_boards_upload),
        ('routes/profiles.js',    rewrite_profiles_upload),
        ('routes/identity.js',    rewrite_identity_upload),
        ('routes/inspections.js', rewrite_inspections_upload),
    ]

    for rel_path, rewrite_fn in files_and_rewrites:
        fpath = os.path.join(ROOT, rel_path)
        content = read(fpath)
        content = inject_cloudinary(content)
        content = rewrite_fn(content)
        write(fpath, content)

# ─────────────────────────────────────────────────────────────────────────────
# Step 4 — Payment routes  →  Direct Stripe SDK
# ─────────────────────────────────────────────────────────────────────────────

# ── routes/bookings.js ───────────────────────────────────────────────────────

BOOKINGS_STRIPE_REQUIRE = '''\
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
'''

BOOKINGS_OLD_PAYMENT_BLOCK = '''\
    let checkoutUrl = null;
    let stripeSessionId = null;

    try {
      const paymentRes = await fetch(`${POLSIA_API_URL}/api/company-payments/checkout-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${POLSIA_API_KEY}`
        },
        body: JSON.stringify({
          name: productName,
          amount: totalEuros,
          success_url: successUrl,
          cancel_url: cancelUrl,
          description: `Swell${isHourly ? ` — ${hours}h` : ` — ${Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000)} jour(s)`}, ${board.location}`
        })
      });

      if (paymentRes.ok) {
        const paymentData = await paymentRes.json();
        checkoutUrl = paymentData.url;
        if (paymentData.session_id) stripeSessionId = paymentData.session_id;
        else if (paymentData.id) stripeSessionId = paymentData.id;
      } else {
        const errText = await paymentRes.text();
        console.error('[Bookings] Payment API error:', paymentRes.status, errText);
      }
    } catch (payErr) {
      console.error('[Bookings] Payment API unreachable:', payErr.message);
    }'''

BOOKINGS_NEW_PAYMENT_BLOCK = '''\
    let checkoutUrl = null;
    let stripeSessionId = null;

    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'eur',
            unit_amount: totalCents,
            product_data: {
              name: productName,
              description: `Swell${isHourly ? ` — ${hours}h` : ` — ${Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000)} jour(s)`}, ${board.location}`,
            },
          },
          quantity: 1,
        }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { booking_id: String(booking.id) },
      });
      checkoutUrl = session.url;
      stripeSessionId = session.id;
    } catch (payErr) {
      console.error('[Bookings] Stripe error:', payErr.message);
    }'''

BOOKINGS_OLD_VERIFY = '''\
    // Verify payment via Polsia
    const verifyRes = await fetch(`${POLSIA_API_URL}/api/company-payments/verify?session_id=${sessionId}`, {
      headers: { Authorization: `Bearer ${POLSIA_API_KEY}` }
    });
    if (!verifyRes.ok) return res.status(402).json({ error: 'Paiement non vérifié' });
    const verifyData = await verifyRes.json();
    const paid = verifyData.paid === true || verifyData.payment_status === 'paid';'''

BOOKINGS_NEW_VERIFY = '''\
    // Verify payment via Stripe directly
    const stripeSession = await stripe.checkout.sessions.retrieve(sessionId);
    const paid = stripeSession.payment_status === 'paid';'''

def step_payments_bookings():
    fpath = os.path.join(ROOT, 'routes', 'bookings.js')
    content = read(fpath)

    # Remove Polsia payment env vars at top
    content = re.sub(r"^const POLSIA_API_URL\s*=.*\n", '', content, flags=re.MULTILINE)
    content = re.sub(r"^const POLSIA_API_KEY\s*=.*\n", '', content, flags=re.MULTILINE)

    # Remove node-fetch (only needed for Polsia) if present at top level
    # Keep it only if there are non-Polsia fetch calls
    # We'll check after: bookings.js only uses fetch for Polsia
    content = re.sub(r"^const fetch\s*=\s*require\('node-fetch'\);\n", '', content, flags=re.MULTILINE)

    # Inject stripe require after the last top-level require
    lines = content.split('\n')
    insert_idx = 0
    for i, line in enumerate(lines):
        if re.match(r"^const .* = require\(", line):
            insert_idx = i + 1
    lines.insert(insert_idx, BOOKINGS_STRIPE_REQUIRE)
    content = '\n'.join(lines)

    # Replace checkout session creation block (post global-rename, "Swell" is already in strings)
    content = content.replace(BOOKINGS_OLD_PAYMENT_BLOCK, BOOKINGS_NEW_PAYMENT_BLOCK)

    # Replace verify block
    if 'Polsia' in content or 'POLSIA_API_URL' in content:
        content = content.replace(BOOKINGS_OLD_VERIFY, BOOKINGS_NEW_VERIFY)

    write(fpath, content)

# ── routes/deposits.js ───────────────────────────────────────────────────────

DEPOSITS_STRIPE_REQUIRE = '''\
const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
'''

def rewrite_deposits(content):
    # Remove Polsia env vars
    content = re.sub(r"^const POLSIA_API_URL\s*=.*\n", '', content, flags=re.MULTILINE)
    content = re.sub(r"^const POLSIA_API_KEY\s*=.*\n", '', content, flags=re.MULTILINE)
    content = re.sub(r"^const fetch\s*=\s*require\('node-fetch'\);\n", '', content, flags=re.MULTILINE)

    # Inject stripe require
    lines = content.split('\n')
    insert_idx = 0
    for i, line in enumerate(lines):
        if re.match(r"^const .* = require\(", line):
            insert_idx = i + 1
    lines.insert(insert_idx, DEPOSITS_STRIPE_REQUIRE)
    content = '\n'.join(lines)

    # Replace PaymentIntent creation via Polsia → direct Stripe
    old_pi = r'''    // Create PaymentIntent with capture_method='manual' — funds are held, not captured\.
    const piRes = await fetch\(`\$\{POLSIA_API_URL\}/api/company-payments/payment-intent`, \{
      method: 'POST',
      headers: \{
        'Content-Type': 'application/json',
        'Authorization': `Bearer \$\{POLSIA_API_KEY\}`
      \},
      body: JSON\.stringify\(\{
        amount: depositEuros,
        currency: 'eur',
        capture_method: 'manual',
        metadata: \{
          booking_id: String\(bookingId\),
          type: 'deposit_hold',
          reference: bookingRef
        \},
        description: `Caution Emprunte — n'est pas débitée\. Libérée 48h après la session si aucun dommage n'est signalé\.`
      \}\)
    \}\);

    if \(!piRes\.ok\) \{
      const errText = await piRes\.text\(\);
      console\.error\('\[Deposits\] PaymentIntent API error:', piRes\.status, errText\);
      return res\.status\(502\)\.json\(\{ error: 'Impossible de créer l\\u2019empreinte de caution' \}\);'''

    new_pi = '''\
    // Create PaymentIntent with capture_method='manual' — funds are held, not captured.
    let piRes_ok = false, pi_id, pi_client_secret, piErr;
    try {
      const pi = await stripe.paymentIntents.create({
        amount: depositCents,
        currency: 'eur',
        capture_method: 'manual',
        metadata: {
          booking_id: String(bookingId),
          type: 'deposit_hold',
          reference: bookingRef
        },
        description: `Caution Swell — n'est pas débitée. Libérée 48h après la session si aucun dommage n'est signalé.`,
      });
      piRes_ok = true;
      pi_id = pi.id;
      pi_client_secret = pi.client_secret;
    } catch (err) {
      piErr = err;
    }

    if (!piRes_ok) {
      console.error('[Deposits] Stripe PaymentIntent error:', piErr?.message);
      return res.status(502).json({ error: 'Impossible de créer l\\u2019empreinte de caution' });'''

    content = re.sub(old_pi, new_pi, content, flags=re.DOTALL)

    # Replace Polsia piRes.json() parsing with direct pi_* vars
    content = re.sub(
        r"const piData = await piRes\.json\(\);",
        "const piData = { id: pi_id, client_secret: pi_client_secret };",
        content
    )

    # Replace release (cancel) PaymentIntent via Polsia
    old_release = r'''const releaseRes = await fetch\(`\$\{POLSIA_API_URL\}/api/company-payments/payment-intent/\$\{booking\.deposit_payment_intent_id\}/cancel`, \{
      method: 'POST',
      headers: \{ Authorization: `Bearer \$\{POLSIA_API_KEY\}` \}
    \}\);
    if \(!releaseRes\.ok\) \{
      const errText = await releaseRes\.text\(\);
      console\.error\('\[Deposits\] Release error', releaseRes\.status, errText\);
      return res\.status\(502\)\.json\(\{ error: 'Libération de la caution échouée' \}\);
    \}'''

    new_release = '''\
    try {
      await stripe.paymentIntents.cancel(booking.deposit_payment_intent_id);
    } catch (err) {
      console.error('[Deposits] Release error', err.message);
      return res.status(502).json({ error: 'Libération de la caution échouée' });
    }'''

    content = re.sub(old_release, new_release, content, flags=re.DOTALL)

    # Replace capture PaymentIntent via Polsia
    old_capture = r'''const captureRes = await fetch\(`\$\{POLSIA_API_URL\}/api/company-payments/payment-intent/\$\{booking\.deposit_payment_intent_id\}/capture`, \{
      method: 'POST',
      headers: \{
        'Content-Type': 'application/json',
        Authorization: `Bearer \$\{POLSIA_API_KEY\}`
      \},
      body: JSON\.stringify\(\{ amount_to_capture: amountToCaptureCents \}\)
    \}\);
    if \(!captureRes\.ok\) \{
      const errText = await captureRes\.text\(\);
      console\.error\('\[Deposits\] Capture error', captureRes\.status, errText\);
      return res\.status\(502\)\.json\(\{ error: 'Capture de la caution échouée' \}\);
    \}'''

    new_capture = '''\
    try {
      await stripe.paymentIntents.capture(booking.deposit_payment_intent_id, {
        amount_to_capture: amountToCaptureCents,
      });
    } catch (err) {
      console.error('[Deposits] Capture error', err.message);
      return res.status(502).json({ error: 'Capture de la caution échouée' });
    }'''

    content = re.sub(old_capture, new_capture, content, flags=re.DOTALL)

    return content


def step_payments_deposits():
    fpath = os.path.join(ROOT, 'routes', 'deposits.js')
    content = read(fpath)
    content = rewrite_deposits(content)
    write(fpath, content)

# ─────────────────────────────────────────────────────────────────────────────
# Step 5 — package.json: add resend, cloudinary, stripe; rename package
# ─────────────────────────────────────────────────────────────────────────────

def step_package_json():
    print("\n[5/5] Update package.json")
    fpath = os.path.join(ROOT, 'package.json')
    pkg = json.loads(read(fpath))

    pkg['name'] = 'swell'

    deps = pkg.setdefault('dependencies', {})
    deps['resend']      = '^3.2.0'
    deps['cloudinary']  = '^1.41.3'
    deps['stripe']      = '^14.25.0'

    # Remove form-data if no longer needed (Cloudinary SDK handles its own uploads)
    # Keep it for now — other code might still use it
    # deps.pop('form-data', None)

    write(fpath, json.dumps(pkg, indent=2, ensure_ascii=False) + '\n')

# ─────────────────────────────────────────────────────────────────────────────
# Step 4 wrapper (calls both payment functions)
# ─────────────────────────────────────────────────────────────────────────────

def step_payments():
    print("\n[4/5] Replace Polsia payment API → Direct Stripe SDK")
    step_payments_bookings()
    step_payments_deposits()

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  migrate-to-swell.py — Starting migration")
    print("=" * 60)

    step_global_rename()
    step_email()
    step_photos()
    step_payments()
    step_package_json()

    print("\n" + "=" * 60)
    print("  Migration complete.")
    print("  Next steps:")
    print("  1. Run: npm install")
    print("  2. Set env vars:")
    print("       RESEND_API_KEY")
    print("       CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET")
    print("       STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY")
    print("       EMAIL_FROM  (e.g. 'Swell <noreply@swell.fr>')")
    print("  3. Test locally, then push to GitHub.")
    print("=" * 60)

if __name__ == '__main__':
    main()
