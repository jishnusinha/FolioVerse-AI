import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.js';

const PDF = new Uint8Array(readFileSync(new URL('../../../datasets/synthetic/docs/atlas-brief.pdf', import.meta.url)));

test.use({ apiOptions: { pdfBytes: PDF } });

// Captures review screenshots of the Gate 3 screens into test-results/ (not a regression baseline).
test('gate 3 screens', async ({ page, fakeApi }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = fakeApi.db.sources.find((x) => x.title === 'Market Outlook 2026.pdf');
  await page.goto(`/app/knowledge/projects/${s.projectId}/documents/${s.id}`);
  const chat = page.getByRole('complementary', { name: 'Grounded conversation' });
  await chat.getByRole('button', { name: /^Citation S1/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Open at location/ }).click();
  await expect(page.locator('[data-hl="true"]')).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: 'test-results/gate3/document.png' });

  await chat.getByRole('button', { name: /Run receipt/ }).click();
  await chat.getByRole('link', { name: /Open in Developer Studio/ }).click();
  await expect(page.getByRole('group', { name: /LangGraph workflow/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/gate3/studio.png' });

  await page.goto('/app/costs');
  await expect(page.getByRole('table', { name: /Recent AI runs/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/gate3/costs.png' });

  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Continue a conversation' })).toBeVisible();
  await page.screenshot({ path: 'test-results/gate3/home.png' });
});
