import { test, expect } from './fixtures.js';

test.use({ apiOptions: { superAdmin: true, anomaly: true, allModels: true } });

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

// Gate 9 in a real browser: the personal Cost Center (budgets, local compute, estimator, CSV export), budget
// settings, notifications, and the super-admin Cost Command Center, price history and model registry.
// Screenshots go to test-results/gate9 for review. All figures are DEMO data from the in-memory fake API.
test('gate 9 cost intelligence', async ({ page, fakeApi }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/costs');
  await expect(page.getByRole('heading', { level: 1, name: 'Your AI usage' })).toBeVisible();
  await expect(page.getByText(/finalized of \$5\.00/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Cost estimator' }).getByText(/With .*mock-concise/)).toBeVisible();
  await page.screenshot({ path: 'test-results/gate9/cost-center.png', fullPage: true });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toBe('folioverse-costs-30d.csv');

  await page.getByRole('button', { name: 'Notifications, 1 unread' }).click();
  await expect(page.getByRole('dialog', { name: 'Notifications' }).getByRole('link', { name: 'Unusual AI spend' })).toBeVisible();
  await page.screenshot({ path: 'test-results/gate9/notifications.png' });
  await page.keyboard.press('Escape');

  await page.goto('/app/settings/budgets');
  const form = page.getByRole('form', { name: 'Add a budget' });
  await form.getByRole('combobox').nth(1).selectOption({ label: 'Project Atlas' });
  await form.getByRole('textbox', { name: /^Limit \(USD\)/ }).fill('2.50');
  await form.getByRole('button', { name: 'Add budget' }).click();
  await expect(page.getByRole('table', { name: 'Budgets in this workspace' }).getByText('Project Project Atlas')).toBeVisible();
  await page.screenshot({ path: 'test-results/gate9/budgets.png', fullPage: true });

  await page.goto('/app/admin/costs');
  await expect(page.getByRole('heading', { level: 1, name: 'Cost Command Center' })).toBeVisible();
  await page.getByRole('button', { name: 'Recompute rollups' }).click();
  await expect(page.getByText(/Rollups updated/)).toBeVisible();
  const recon = page.getByRole('region', { name: 'Reconciliation' });
  await recon.getByRole('textbox', { name: /^Provider/ }).fill('mock');
  const day = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  await recon.getByLabel(/Cost report \(CSV\)/).fill(`date,amount\n${day},0.50`);
  await recon.getByRole('button', { name: 'Import and reconcile' }).click();
  await expect(recon.getByText('+$0.50')).toBeVisible();
  await expect(page.locator('.recharts-bar-rectangle').first()).toBeAttached();
  await page.screenshot({ path: 'test-results/gate9/command-center.png', fullPage: true });

  await page.goto('/app/admin/pricing');
  await expect(page.getByRole('region', { name: /mock-grounded price history/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/gate9/prices.png', fullPage: true });

  await page.goto('/app/admin/models');
  await expect(page.getByText('waiting for FV_OPENAI_CHAT_MODEL')).toBeVisible();
  await page.screenshot({ path: 'test-results/gate9/models.png', fullPage: true });
  expect(fakeApi.db.log).toContain('POST /admin/costs/reconciliation/import');
});
