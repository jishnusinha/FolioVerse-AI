import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.js';

const PDF = new Uint8Array(readFileSync(new URL('../../../datasets/synthetic/docs/atlas-brief.pdf', import.meta.url)));

test.use({ apiOptions: { pdfBytes: PDF, artifacts: ['study_notes'] } });

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

// Gate 4 in a real browser: React Flow knowledge map, text selection with Folio Lens, artifacts and search.
// Screenshots go to test-results/gate4 for review (not a regression baseline).
test('gate 4 knowledge screens', async ({ page, fakeApi }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const s = fakeApi.db.sources.find((x) => x.title === 'Market Outlook 2026.pdf');
  await page.goto(`/app/knowledge/projects/${s.projectId}/documents/${s.id}`);
  await expect(page.locator('#pdf-page-1 canvas')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('tab', { name: 'Insights' }).click();
  const insights = page.getByRole('tabpanel', { name: 'Insights' });
  await insights.getByRole('button', { name: 'Create Knowledge Map' }).click();
  await expect(insights.locator('.react-flow__node')).toHaveCount(4, { timeout: 10_000 });
  await expect(insights.getByRole('link', { name: 'Open artifact' })).toBeVisible();
  await page.screenshot({ path: 'test-results/gate4/knowledge-map.png' });
  await insights.locator('.react-flow__node', { hasText: 'Bundled office suites' }).click();
  await expect(page.getByRole('dialog').getByText(/Bundled office suites are the main pricing risk/)).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Text' }).click();
  const para = page.locator('#page-3 [data-text]', { hasText: '412 organisations' });
  await para.selectText();
  await page.locator('#docpane').dispatchEvent('mouseup');
  const lens = page.getByRole('dialog', { name: 'Folio Lens' });
  await expect(lens).toBeVisible();
  await page.screenshot({ path: 'test-results/gate4/lens.png' });
  await lens.getByRole('menuitem', { name: 'Add to notes' }).click();
  const notes = page.getByRole('tabpanel', { name: 'Notes' });
  await notes.getByLabel('Note on the selected passage').fill('Check the regional weighting.');
  await notes.getByRole('button', { name: 'Add note' }).click();
  await expect(notes.getByRole('list', { name: 'Notes' }).getByText('Check the regional weighting.')).toBeVisible();
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Original' }).click();
  await notes.getByRole('button', { name: 'Show in document' }).click();
  await expect(page.locator('#page-3 mark')).toContainText('412 organisations');
  await page.screenshot({ path: 'test-results/gate4/notes.png' });

  const a = fakeApi.db.knowledge.artifacts[0];
  await page.goto(`/app/knowledge/projects/${a.projectId}/artifacts/${a.id}`);
  await expect(page.getByRole('heading', { level: 1, name: a.title })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Built from' }).getByText('v1')).toBeVisible();
  await page.screenshot({ path: 'test-results/gate4/artifact.png' });

  await page.goto('/app/search?q=pricing');
  await expect(page.getByRole('region', { name: 'Passages' })).toBeVisible();
  await page.screenshot({ path: 'test-results/gate4/search.png' });

  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill('Competitor');
  await page.getByRole('option', { name: /Competitor Notes\.md/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Competitor Notes.md' })).toBeVisible();
  expect(fakeApi.db.log.filter((l) => l.startsWith('POST') && l.endsWith('/runs'))).toHaveLength(1);
});
