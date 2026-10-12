import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.js';

const epubBytes = new Uint8Array(readFileSync(new URL('../../../datasets/synthetic/books/small-lanterns.epub', import.meta.url)));
test.use({ apiOptions: { epubBytes } });

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

/** Selects the first `length` characters of paragraph `index` inside the epub.js iframe. */
async function selectInBook(page, index, length) {
  await page
    .frameLocator('.epub-host iframe')
    .locator('p')
    .nth(index)
    .evaluate((p, n) => {
      const doc = p.ownerDocument;
      const r = doc.createRange();
      r.setStart(p.firstChild, 0);
      r.setEnd(p.firstChild, n);
      const s = doc.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }, length);
  const lens = page.getByRole('dialog', { name: 'Folio Lens' });
  await expect(lens).toBeVisible({ timeout: 5_000 });
  return lens;
}

// Gate 6 in a real browser: the synthetic DEMO EPUB rendered by epub.js, highlights painted from CFIs,
// spoiler-guarded explain, typography preferences. Screenshots go to test-results/gate6 for review.
test('gate 6 library and reader', async ({ page, fakeApi }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/library');
  await expect(page.getByRole('region', { name: 'Currently reading' })).toBeVisible();
  await page.screenshot({ path: 'test-results/gate6/library.png' });
  await page.getByRole('group', { name: 'Layout' }).getByRole('button', { name: 'List' }).click();
  await expect(page.getByRole('table', { name: 'Books' })).toBeVisible();
  await page.screenshot({ path: 'test-results/gate6/library-list.png' });

  await page.getByRole('link', { name: 'Continue reading' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Orbit of Small Lanterns' })).toBeVisible();
  const book = page.frameLocator('.epub-host iframe');
  await expect(book.getByText(/^Teodor Lusk had kept the archive/)).toBeVisible({ timeout: 15_000 });
  const toc = page.getByRole('list', { name: 'Table of contents' });
  await expect(toc.getByRole('button')).toHaveCount(4);
  await expect(toc.getByRole('button', { name: /The Archivist/ })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('region', { name: 'Reader' }).getByText(/Chapter 2 — The Archivist/)).toBeVisible();

  await toc.getByRole('button', { name: /The Halcyon Ring/ }).click();
  await expect(book.getByText(/^Ilse Varga woke/)).toBeVisible();
  await expect(toc.getByRole('button', { name: /The Halcyon Ring/ })).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.epub-host g.fv-hl')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/gate6/reader.png' });

  let lens = await selectInBook(page, 0, 46);
  await expect(lens.getByRole('menuitem')).toHaveText(['Define', 'Explain', 'Summarize passage', 'Highlight', 'Add note', 'Save as excerpt']);
  await page.screenshot({ path: 'test-results/gate6/reader-lens.png' });
  await lens.getByRole('menuitem', { name: 'Highlight' }).click();
  await expect(page.locator('.epub-host g.fv-hl')).toHaveCount(2);
  await expect.poll(() => fakeApi.db.library.annotations.length).toBe(2);
  // epub.js only writes an `[id]` assertion when the spine itemref has an id; the href places the passage.
  expect(fakeApi.db.library.annotations[1].locator).toMatchObject({ href: 'chapter-1.xhtml', locations: { cfi: expect.stringMatching(/^epubcfi\(\/6\/2(\[[^\]]*\])?!\/4\/4,/) } });

  lens = await selectInBook(page, 2, 79);
  await lens.getByRole('menuitem', { name: 'Explain' }).click();
  const panel = page.getByRole('region', { name: 'Explanation of the selected passage' });
  await expect(panel.getByText(/Later\s+chapters are never sent/)).toBeVisible();
  await expect(panel.getByText(/sets up the mystery/)).toBeVisible({ timeout: 10_000 });
  await expect(panel.getByRole('button', { name: /Citation S1/ })).toBeEnabled();
  expect(fakeApi.db.ai.runs.at(-1).input.params).toMatchObject({ mode: 'explain', page: 1 });
  await page.screenshot({ path: 'test-results/gate6/reader-explain.png' });

  await page.getByRole('button', { name: /Reader settings/ }).click();
  const settings = page.getByRole('group', { name: 'Reader settings' });
  await settings.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Night' }).click();
  await settings.getByRole('group', { name: 'Line width' }).getByRole('button', { name: 'Narrow' }).click();
  await expect(page.locator('.reader')).toHaveAttribute('data-rt', 'night');
  const fits = () =>
    book.locator('p').first().evaluate((p) => {
      const frame = p.ownerDocument.defaultView.frameElement.getBoundingClientRect();
      const host = p.ownerDocument.defaultView.frameElement.closest('.epub-host').getBoundingClientRect();
      return p.getBoundingClientRect().right <= Math.min(frame.width, host.right - frame.left) + 1;
    });
  await expect.poll(fits).toBe(true);
  await page.screenshot({ path: 'test-results/gate6/reader-night.png' });

  await expect.poll(() => fakeApi.db.library.progress[0].locator.href, { timeout: 5_000 }).toBe('chapter-1.xhtml');
});
