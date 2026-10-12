import { test, expect } from '@playwright/test';
import { VIEWPORTS } from './viewports.js';

// Baselines are per platform (fonts differ). Update with: pnpm --filter @folioverse/web test:vr -- --update-snapshots
test.describe('visual baseline', () => {
  for (const vp of VIEWPORTS) {
    test(`shell at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/app');
      await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
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
