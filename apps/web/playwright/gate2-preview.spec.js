import { test, expect } from './fixtures.js';

// Captures review screenshots of the Gate 2 screens into test-results/ (not a regression baseline).
test('gate 2 screens', async ({ page, fakeApi }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const atlas = fakeApi.db.projects.find((p) => p.name === 'Project Atlas');
  await page.goto(`/app/knowledge/projects/${atlas.id}`);
  await page.getByRole('button', { name: /Market Outlook 2026\.pdf/ }).click();
  await expect(page.getByRole('complementary', { name: 'Document details' }).getByRole('heading', { name: 'Market Outlook 2026.pdf' })).toBeVisible();
  await page.screenshot({ path: 'test-results/gate2/project.png' });
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await page.getByLabel('Choose files').setInputFiles([
    { name: 'Field Notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Notes') },
    { name: 'tool.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') },
  ]);
  await page.screenshot({ path: 'test-results/gate2/upload.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Account:/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.screenshot({ path: 'test-results/gate2/login.png' });
});
