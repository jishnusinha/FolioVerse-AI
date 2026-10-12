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
});
