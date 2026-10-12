import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

/**
 * Gate 3 slice against a real running stack (no fake API): register → upload the synthetic PDF →
 * READY → ask → cited answer → citation highlight → Studio → receipt → Cost Center.
 * Opt-in: FV_E2E_BASE_URL=http://localhost:5173 (with `pnpm dev`) or http://localhost:8080 (`pnpm up`).
 * Uses whatever model the registry resolves; with no provider key that is the DEMO mock model.
 */
const BASE = process.env.FV_E2E_BASE_URL;
const PDF = readFileSync(new URL('../../../datasets/synthetic/docs/atlas-brief.pdf', import.meta.url));

test.describe('gate 3 vertical slice (live stack)', () => {
  test.skip(!BASE, 'set FV_E2E_BASE_URL to run against a live stack');
  test.use({ baseURL: BASE });
  test.setTimeout(300_000);

  test('register, upload, ask with citations, inspect the trace and the cost', async ({ page }) => {
    page.on('pageerror', (e) => {
      throw e;
    });
    await page.goto('/auth/register?next=/app/knowledge');
    await page.getByLabel(/^Name/).fill('Slice Tester');
    await page.getByLabel(/^Email/).fill(`slice+${randomBytes(4).toString('hex')}@example.test`);
    await page.getByLabel(/^Password/).fill(`Pw-${randomBytes(12).toString('base64url')}`);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/app\/knowledge$/);

    await page.getByRole('link', { name: /My Knowledge/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'My Knowledge' })).toBeVisible();
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Upload documents' });
    await dialog.getByLabel('Choose files').setInputFiles([{ name: 'atlas-brief.pdf', mimeType: 'application/pdf', buffer: PDF }]);
    await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(dialog.getByText(/Preview ready|Parsing|Indexing|Ready/).first()).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    const row = page.getByRole('row', { name: /atlas-brief\.pdf/ });
    await expect(row.getByTitle(/· READY$/)).toBeVisible({ timeout: 120_000 });
    await page.getByRole('button', { name: /atlas-brief\.pdf/ }).first().click();
    await page.getByRole('link', { name: 'Open', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'atlas-brief.pdf' })).toBeVisible();
    await expect(page.locator('#pdf-page-1 canvas')).toBeVisible({ timeout: 30_000 });

    await page.getByLabel('Ask a grounded question').fill('How many organisations did the survey cover?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    const chat = page.getByRole('region', { name: 'Grounded conversation' });
    const chip = chat.getByRole('button', { name: /^Citation S\d+: Verified quote/ }).first();
    await expect(chip).toBeVisible({ timeout: 120_000 });
    await expect(chat.getByText('Answered')).toBeVisible();

    await chip.click();
    await page.getByRole('dialog').getByRole('button', { name: /Open at location/ }).click();
    await expect(page.locator('[data-hl="true"]')).toBeVisible();

    await expect(chat.getByRole('button', { name: /Run receipt/ })).toBeVisible({ timeout: 30_000 });
    await chat.getByRole('button', { name: /Run receipt/ }).click();
    await expect(chat.getByText(/Finalized|Final \(estimated\)/).first()).toBeVisible({ timeout: 30_000 });
    await chat.getByRole('link', { name: /Open in Developer Studio/ }).click();
    const graph = page.getByRole('group', { name: 'LangGraph workflow grounded_qa' });
    await expect(graph.getByRole('button', { name: 'generate: succeeded' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Execution events' }).getByText('run.finished')).toBeVisible();

    await page.getByRole('link', { name: 'Cost Center' }).click();
    await expect(page.getByRole('table', { name: /Recent AI runs/ }).getByText(/Finalized|Final \(estimated\)/)).toBeVisible();
  });

  // Gate 7 against the real recommender: needs the DEMO catalog loaded (`db:seed` with FV_DEMO_CATALOG=true).
  test('discover: onboard, why this, explain, lab re-rank and offline evaluation', async ({ page }) => {
    page.on('pageerror', (e) => {
      throw e;
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/auth/register?next=/app/discover');
    await page.getByLabel(/^Name/).fill('Discover Tester');
    await page.getByLabel(/^Email/).fill(`discover+${randomBytes(4).toString('hex')}@example.test`);
    await page.getByLabel(/^Password/).fill(`Pw-${randomBytes(12).toString('base64url')}`);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Tell us what you like' })).toBeVisible();
    await page.getByRole('group', { name: 'Genres' }).getByRole('button', { name: 'Sci-fi' }).click();
    await page.getByRole('group', { name: 'Moods' }).getByRole('button', { name: 'Atmospheric' }).click();
    await page.getByRole('group', { name: 'Favourites' }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Save my taste' }).click();

    const cards = page.getByRole('article');
    await expect(cards).toHaveCount(12, { timeout: 30_000 });
    await page.getByLabel('Describe what you want').fill('lonely space stations and memory');
    await page.getByRole('button', { name: 'Discover', exact: true }).click();
    await expect(page.getByText(/results · ranked by meaning.*recsys-hybrid v\d+/)).toBeVisible();
    await page.screenshot({ path: 'test-results/gate7-live/discover.png' });

    await cards.first().getByRole('button', { name: 'Why this?' }).click();
    const drawer = page.getByRole('dialog', { name: 'Why this?' });
    await expect(drawer.getByRole('progressbar')).toHaveCount(5);
    await drawer.getByRole('button', { name: 'Explain in words' }).click();
    await expect(drawer.getByRole('region', { name: 'Explanation in words' }).getByText(/ranked here/)).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: 'test-results/gate7-live/why-this.png' });
    await page.keyboard.press('Escape');

    await page.getByRole('link', { name: 'Recommendation Lab' }).click();
    const list = page.getByRole('table', { name: 'Re-ranked titles' });
    await expect(list.getByRole('row')).toHaveCount(11, { timeout: 30_000 });
    await page.getByLabel('Theme overlap').fill('1');
    await expect(list.locator('.rank-up, .rank-down').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('region', { name: 'Served model' }).getByText(/recsys-hybrid v\d+/)).toBeVisible();
    const evaluation = page.getByRole('region', { name: 'Offline evaluation' });
    await evaluation.getByRole('button', { name: 'Run evaluation' }).click();
    await expect(evaluation.getByRole('table', { name: 'Offline evaluation at K=10' })).toBeVisible({ timeout: 120_000 });
    await page.screenshot({ path: 'test-results/gate7-live/lab.png', fullPage: true });
  });
});
