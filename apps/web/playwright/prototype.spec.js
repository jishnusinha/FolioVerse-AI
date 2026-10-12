import { test, expect } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { VIEWPORTS } from './viewports.js';

const PROTOTYPE = pathToFileURL(fileURLToPath(new URL('../../../design-prototype/index.html', import.meta.url))).href;
const REFERENCE_DIR = fileURLToPath(new URL('./reference/', import.meta.url));

const PROTOTYPE_VIEWS = [
  ['auth', '/onboarding'],
  ['home', '/app'],
  ['knowledge', '/app/knowledge'],
  ['doc', '/app/knowledge/projects/atlas/documents/market-outlook'],
  ['writer', '/app/writer/manuscripts/glass-meridian'],
  ['dna', '/app/writer/manuscripts/glass-meridian/dna'],
  ['library', '/app/library'],
  ['reader', '/app/library/books/small-lanterns/read'],
  ['discover', '/app/discover'],
  ['studio', '/app/studio/runs/run_01JD7Q2M'],
  ['costs', '/app/costs'],
  ['admin', '/app/admin/costs'],
  ['docs', '/app/docs'],
  ['settings', '/app/settings/models'],
];

async function open(page, hash) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${PROTOTYPE}#${hash}`);
  await expect(page.locator('#main')).not.toBeEmpty();
  return errors;
}

test.describe('design prototype', () => {
  for (const [view, hash] of PROTOTYPE_VIEWS) {
    test(`renders ${view} without script errors`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const errors = await open(page, hash);
      await expect(page.locator('#main h1, #main h2').first()).toBeVisible();
      expect(errors).toEqual([]);
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${REFERENCE_DIR}view-${view}-1440.png` });
    });
  }

  for (const vp of VIEWPORTS) {
    test(`records home reference at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      expect(await open(page, '/app')).toEqual([]);
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${REFERENCE_DIR}home-${vp.name}.png` });
    });
  }

  test('command palette navigates', async ({ page }) => {
    await open(page, '/app');
    await page.keyboard.press('Control+k');
    const input = page.getByRole('combobox');
    await expect(input).toBeFocused();
    await input.fill('library');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/app\/library$/);
  });

  test('drawer opens as a modal dialog and restores focus', async ({ page }) => {
    await open(page, '/app');
    const trigger = page.getByRole('button', { name: /Notifications/ });
    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'Notifications' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('folio lens opens from the writer gutter and closes on Escape', async ({ page }) => {
    await open(page, '/app/writer/manuscripts/glass-meridian');
    await page.locator('[data-act="wlens"]').first().click();
    const lens = page.getByRole('dialog', { name: 'Folio Lens' });
    await expect(lens).toBeVisible();
    await expect(lens.getByRole('button').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(lens).toHaveCount(0);
  });
});
