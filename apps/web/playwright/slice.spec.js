import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.js';

const PDF = new Uint8Array(readFileSync(new URL('../../../datasets/synthetic/docs/atlas-brief.pdf', import.meta.url)));

test.describe('gate 3 vertical slice (fake API)', () => {
  test.use({ apiOptions: { advance: true, pdfBytes: PDF } });

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (e) => {
      throw e;
    });
  });

  test('upload a PDF, ask, open the citation in the PDF, then inspect the run and its cost', async ({ page, fakeApi }) => {
    const atlas = fakeApi.db.projects.find((p) => p.name === 'Project Atlas');
    await page.goto(`/app/knowledge/projects/${atlas.id}`);
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Upload documents' });
    await dialog.getByLabel('Choose files').setInputFiles([{ name: 'atlas-brief.pdf', mimeType: 'application/pdf', buffer: Buffer.from(PDF) }]);
    await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(dialog.getByText('Preview ready')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    const row = page.getByRole('row', { name: /atlas-brief\.pdf/ });
    await expect(row.getByTitle(/· READY$/)).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /atlas-brief\.pdf/ }).first().click();
    await page.getByRole('link', { name: 'Open', exact: true }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'atlas-brief.pdf' })).toBeVisible();
    await expect(page.locator('#pdf-page-3 canvas')).toBeVisible({ timeout: 15_000 });

    await page.getByLabel('Ask a grounded question').fill('How many organisations did the survey cover?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    const chat = page.getByRole('complementary', { name: 'Grounded conversation' });
    await expect(chat.getByText(/The survey covered 412 organisations across three regions/)).toBeVisible();
    const chip = chat.getByRole('button', { name: 'Citation S1: Verified quote, Exact location' });
    await expect(chip).toBeVisible();

    await chip.click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('The survey covered 412 organisations across three regions in the spring of 2026.')).toBeVisible();
    await drawer.getByRole('button', { name: /Open at location/ }).click();
    const hl = page.locator('#pdf-page-3 [data-hl="true"]');
    await expect(hl).toBeVisible();
    await expect(hl).toBeInViewport();

    await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Text' }).click();
    await expect(page.locator('#page-3 mark')).toHaveText('The survey covered 412 organisations across three regions in the spring of 2026.');

    await chat.getByRole('button', { name: /Run receipt/ }).click();
    await expect(chat.getByText('Finalized').first()).toBeVisible();
    await chat.getByRole('link', { name: /Open in Developer Studio/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'AI Developer Studio' })).toBeVisible();
    const graph = page.getByRole('group', { name: 'LangGraph workflow grounded_qa' });
    await expect(graph.getByRole('button', { name: 'validate_citations: succeeded' })).toBeVisible();
    await expect(graph.getByRole('button', { name: 'abstain: skipped' })).toBeVisible();

    await page.getByRole('link', { name: 'Cost Center' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Your AI usage' })).toBeVisible();
    await expect(page.getByRole('table', { name: /Recent AI runs/ }).getByText('Finalized')).toHaveCount(2);
    expect(fakeApi.db.log.filter((l) => l.startsWith('POST') && l.endsWith('/runs'))).toHaveLength(1);
  });
});
