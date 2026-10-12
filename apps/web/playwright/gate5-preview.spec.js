import { test, expect } from './fixtures.js';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

// Gate 5 in a real browser: TipTap typing and autosave, suggestions, Narrative DNA graph, continuity and print.
// Screenshots go to test-results/gate5 for review (not a regression baseline).
test('gate 5 writer screens', async ({ page, fakeApi }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const m = fakeApi.db.writer.manuscripts.find((x) => x.title === 'The Glass Meridian');
  const msUrl = `/app/writer/manuscripts/${m.id}`;
  const status = page.getByRole('region', { name: 'Scene editor' }).getByRole('status').first();

  await page.goto('/app/writer');
  await expect(page.getByRole('link', { name: /The Glass Meridian/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/gate5/writer-home.png' });

  await page.goto(msUrl);
  const prose = page.getByRole('textbox', { name: 'Scene text: The Storm Bell' });
  await expect(prose).toBeVisible({ timeout: 15_000 });
  await expect(status).toHaveText('Saved · r0');
  await prose.locator('[data-block-id="blk-storm-1"]').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Rain came sideways.');
  await expect(status).toHaveText('Unsaved changes');
  await expect(status).toHaveText('Saved · r1', { timeout: 10_000 });
  expect(fakeApi.db.writer.docs.find((d) => d.text.includes('Rain came sideways.'))).toBeTruthy();

  await page.getByRole('button', { name: /Open Folio Lens/ }).click();
  const lens = page.getByRole('dialog', { name: 'Folio Lens' });
  await expect(lens).toBeVisible();
  await page.screenshot({ path: 'test-results/gate5/lens.png' });
  await lens.getByRole('menuitem', { name: 'Tighten' }).click();
  const card = page.getByRole('listitem', { name: 'Suggestion for ¶1' });
  await expect(card.getByRole('button', { name: 'Accept' })).toBeVisible({ timeout: 10_000 });
  await expect(prose.locator('.w-pending')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/gate5/suggestion.png' });
  await card.getByRole('button', { name: 'Accept' }).click();
  await expect(prose.locator('[data-block-id="blk-storm-1"]')).toHaveAttribute('data-ai', 'true');
  await expect(status).toHaveText('Saved · r2');

  await page.getByRole('tab', { name: /^Context/ }).click();
  await page.getByRole('button', { name: 'Check this scene' }).click();
  await expect(page.getByRole('listitem', { name: 'Continuity issue: Mara, eye color' })).toBeVisible({ timeout: 10_000 });
  await expect(prose.locator('.w-flagged')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/gate5/continuity-panel.png' });

  await page.getByRole('tab', { name: /^History/ }).click();
  await page.getByRole('list', { name: 'Revisions' }).getByRole('button', { name: /r0/ }).click();
  await expect(page.getByRole('button', { name: 'Restore r0' })).toBeVisible();
  await page.screenshot({ path: 'test-results/gate5/history.png' });

  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect(page.locator('.w-panes.focus')).toBeVisible();
  await page.screenshot({ path: 'test-results/gate5/focus.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.w-panes.focus')).toHaveCount(0);

  await page.goto(`${msUrl}/dna`);
  await expect(page.getByRole('heading', { level: 1, name: 'Story canon & continuity' })).toBeVisible();
  await page.getByRole('button', { name: 'Extract from manuscript' }).click();
  await expect(page.getByRole('list', { name: 'Proposed facts' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.react-flow__node.sg-node').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/gate5/dna.png', fullPage: true });
  await page.getByRole('button', { name: 'Approve: Tomas is a character in the story.' }).click();
  await expect(page.getByRole('table').getByText('Tomas is a character in the story.')).toBeVisible();

  await page.goto(`${msUrl}/continuity`);
  await expect(page.getByRole('listitem', { name: 'Continuity issue: Mara, eye color' })).toBeVisible();
  await page.screenshot({ path: 'test-results/gate5/continuity.png' });

  await page.goto(`${msUrl}/print`);
  await expect(page.getByRole('heading', { level: 1, name: 'The Glass Meridian' })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.rail')).toBeHidden();
  await page.screenshot({ path: 'test-results/gate5/print.png', fullPage: true });
  await page.emulateMedia({ media: 'screen' });
});
