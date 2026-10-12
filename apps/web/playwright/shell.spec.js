import { test, expect } from './fixtures.js';

test.describe('application shell (built app)', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (e) => {
      throw e;
    });
  });

  test('every top-level section renders inside the shell', async ({ page }) => {
    for (const [path, title] of [
      ['/app', 'Home'],
      ['/app/knowledge', 'Folio Knowledge'],
      ['/app/writer', 'Folio Writer'],
      ['/app/library', 'Library'],
      ['/app/discover', 'Discover'],
      ['/app/studio', 'AI Developer Studio'],
      ['/app/costs', 'Cost Center'],
      ['/app/docs/design', 'Component gallery'],
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    }
  });

  test('palette navigates by keyboard', async ({ page }) => {
    await page.goto('/app');
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('combobox')).toBeFocused();
    await page.keyboard.type('discover');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/app\/discover$/);
  });

  test('theme persists across reloads', async ({ page }) => {
    await page.goto('/app');
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(17, 18, 22)');
  });

  test('studio is dark while the rest of the app stays light', async ({ page }) => {
    await page.goto('/app/studio');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const mainBg = await page.locator('#main').evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(mainBg).toBe('rgb(18, 19, 24)');
  });

  test('skip link moves focus to main content', async ({ page }) => {
    await page.goto('/app');
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });

  test('folio lens and evidence drawer work from the gallery', async ({ page }) => {
    await page.goto('/app/docs/design');
    await page.getByRole('button', { name: 'Folio Lens' }).click();
    const lens = page.getByRole('dialog', { name: 'Folio Lens' });
    await expect(lens).toBeVisible();
    await expect(lens.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(lens).toHaveCount(0);
    await page.getByRole('button', { name: 'Evidence drawer' }).click();
    await expect(page.getByRole('dialog', { name: 'Evidence S1' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Evidence drawer' })).toBeFocused();
  });

  test('mobile layout moves navigation to a bottom bar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app');
    const rail = page.getByRole('navigation', { name: 'Primary' });
    const box = await rail.boundingBox();
    expect(box.y).toBeGreaterThan(700);
    await expect(page.getByRole('button', { name: 'More destinations' })).toBeVisible();
  });
});
