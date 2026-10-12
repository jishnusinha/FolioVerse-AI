import { test, expect } from './fixtures.js';
import { VIEWPORTS } from './viewports.js';

// Baselines are per platform (fonts differ). Update with: pnpm --filter @folioverse/web test:vr -- --update-snapshots
test.describe('visual baseline', () => {
  // No seeded runs or conversations: Home would otherwise show dates relative to today.
  test.use({ apiOptions: { empty: true } });

  for (const vp of VIEWPORTS) {
    test(`shell at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/app');
      await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Project Atlas' })).toBeVisible();
      await expect(page.getByText('Runs appear here after your first question.')).toBeVisible();
      await expect(page).toHaveScreenshot(`shell-${vp.name}.png`);
    });
  }

  for (const theme of ['light', 'dark']) {
    test(`component gallery (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('fv-theme', JSON.stringify({ state: { theme: t }, version: 0 })), theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/app/docs/design');
      await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible();
      await expect(page).toHaveScreenshot(`gallery-${theme}.png`, { fullPage: true });
    });
  }
});
