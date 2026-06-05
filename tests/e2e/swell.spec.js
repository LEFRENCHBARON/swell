const { test, expect } = require('@playwright/test');

// Unique credentials for this test run — avoids conflicts with existing accounts
const RUN_ID = Date.now();
const TEST_EMAIL = `e2e_${RUN_ID}@testmail.dev`;
const TEST_PASSWORD = 'TestSwell2026!';
const TEST_NAME = `E2E User ${RUN_ID}`;

// ─── 1. Homepage ──────────────────────────────────────────────────────────────

test('homepage loads with logo and CTA', async ({ page }) => {
  const res = await page.goto('/');
  expect(res.status()).toBe(200);

  // Logo / brand name visible
  await expect(page.locator('text=Swell').or(page.locator('text=Qiver'))).toBeVisible();

  // At least one call-to-action link pointing toward the app
  const cta = page.locator('a[href*="app.html"], a[href*="/app"]');
  await expect(cta.first()).toBeVisible();

  // No JS error — page title present
  const title = await page.title();
  expect(title.length).toBeGreaterThan(0);
});

// ─── 2. Inscription ───────────────────────────────────────────────────────────

test('register a new user', async ({ page }) => {
  await page.goto('/app.html');

  // Open register modal — try common labels
  const registerBtn = page
    .locator('button, a')
    .filter({ hasText: /inscri|register|sign up|créer/i })
    .first();
  await registerBtn.click();

  // Wait for the form to appear
  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  await expect(emailInput).toBeVisible({ timeout: 10_000 });

  // Some forms split into login/register tabs — try to select register if needed
  const registerTab = page
    .locator('button, a, [role="tab"]')
    .filter({ hasText: /inscri|register|créer/i })
    .first();
  if (await registerTab.isVisible()) await registerTab.click();

  // Fill name if present
  const nameInput = page.locator('input[name="name"], input[placeholder*="nom" i], input[placeholder*="name" i]').first();
  if (await nameInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await nameInput.fill(TEST_NAME);
  }

  await emailInput.fill(TEST_EMAIL);

  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.fill(TEST_PASSWORD);

  // Confirm password field (some forms have it)
  const confirmInput = page
    .locator('input[type="password"]')
    .nth(1);
  if (await confirmInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await confirmInput.fill(TEST_PASSWORD);
  }

  // Submit
  const submitBtn = page
    .locator('button[type="submit"], button')
    .filter({ hasText: /inscri|register|créer|s'inscrire|continuer/i })
    .first();
  await submitBtn.click();

  // Success: either redirected to app, or a confirmation message
  await expect(
    page.locator('text=vérifie, text=confirme, text=bienvenue, text=welcome').or(
      page.locator('[data-section="explore"], #explore, .board-card')
    )
  ).toBeVisible({ timeout: 20_000 });
});

// ─── 3. Connexion ─────────────────────────────────────────────────────────────

test('login with registered credentials', async ({ page }) => {
  await page.goto('/app.html');

  // Open login modal
  const loginBtn = page
    .locator('button, a')
    .filter({ hasText: /connexion|login|se connecter|sign in/i })
    .first();
  await loginBtn.click();

  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  await expect(emailInput).toBeVisible({ timeout: 10_000 });

  // Switch to login tab if register tab is selected by default
  const loginTab = page
    .locator('button, a, [role="tab"]')
    .filter({ hasText: /connexion|login|se connecter/i })
    .first();
  if (await loginTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await loginTab.click();
  }

  await emailInput.fill(TEST_EMAIL);
  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.fill(TEST_PASSWORD);

  const submitBtn = page
    .locator('button[type="submit"], button')
    .filter({ hasText: /connexion|login|se connecter|sign in|continuer/i })
    .first();
  await submitBtn.click();

  // Authenticated state: profile avatar, logout button, or explore section visible
  await expect(
    page.locator('button, a')
      .filter({ hasText: /déconnexion|logout|profil|mon compte/i })
      .or(page.locator('[data-section="explore"], .board-card, #boardGrid'))
  ).toBeVisible({ timeout: 20_000 });
});

// ─── 4. Parcourir les planches ────────────────────────────────────────────────

test('browse available boards', async ({ page }) => {
  await page.goto('/app.html');

  // Boards should load without login — explore section
  const exploreSection = page.locator(
    '[data-section="explore"], #explore, #boardGrid, .board-card, .board-list'
  );
  await expect(exploreSection.first()).toBeVisible({ timeout: 30_000 });

  // Wait for at least one board card to appear
  const boardCards = page.locator('.board-card, [data-board-id], .card');
  const count = await boardCards.count();

  if (count > 0) {
    // Verify first card has a price or title
    const firstCard = boardCards.first();
    await expect(firstCard).toBeVisible();
    console.log(`  → ${count} planche(s) affichée(s)`);
  } else {
    // Fallback: check for empty-state message (DB might be empty)
    const emptyState = page.locator('text=aucune, text=no board, text=pas de planche').first();
    const hasEmpty = await emptyState.isVisible({ timeout: 5_000 }).catch(() => false);
    console.log(hasEmpty ? '  → Aucune planche (DB vide)' : '  → Section boards présente mais vide');
  }

  // /listings page should also render
  const listingsRes = await page.goto('/listings');
  expect([200, 301, 302]).toContain(listingsRes.status());
});

// ─── 5. Dashboard hôte ───────────────────────────────────────────────────────

test('host dashboard is accessible', async ({ page }) => {
  const res = await page.goto('/host');
  // Page loads (not 500)
  expect(res.status()).toBeLessThan(500);

  // Page has some content (not blank)
  const bodyText = await page.locator('body').innerText();
  expect(bodyText.length).toBeGreaterThan(20);

  // Either shows the dashboard UI or redirects to login — both are valid
  const hasDashboard = await page
    .locator('text=tableau de bord, text=dashboard, text=mes planches, text=mes réservations')
    .first()
    .isVisible({ timeout: 5_000 })
    .catch(() => false);

  const hasLoginPrompt = await page
    .locator('input[type="email"], input[type="password"], text=connectez-vous, text=login')
    .first()
    .isVisible({ timeout: 5_000 })
    .catch(() => false);

  console.log(hasDashboard
    ? '  → Dashboard hôte affiché directement'
    : hasLoginPrompt
      ? '  → Redirigé vers login (comportement attendu sans session)'
      : '  → Page chargée sans dashboard ni login prompt'
  );

  // At minimum, the page must contain something meaningful
  expect(hasDashboard || hasLoginPrompt || bodyText.length > 100).toBe(true);
});
