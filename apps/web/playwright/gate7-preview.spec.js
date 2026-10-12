import { test, expect } from './fixtures.js';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

// Gate 7 in a real browser: taste onboarding, Discover cards with the "Why this?" drawer and a rec_explain run,
// saving a book to the Library, the Recommendation Lab re-ranking live and offline evaluation.
// Screenshots go to test-results/gate7 for review.
test('gate 7 discover and recommendation lab', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/discover');
  await expect(page.getByRole('heading', { name: 'Tell us what you like' })).toBeVisible();
  await page.getByRole('group', { name: 'Genres' }).getByRole('button', { name: 'Sci-fi' }).click();
  await page.getByRole('group', { name: 'Moods' }).getByRole('button', { name: 'Atmospheric' }).click();
  await page.getByRole('group', { name: 'Themes' }).getByRole('button', { name: 'memory' }).click();
  await page.getByRole('group', { name: 'Favourites' }).getByRole('button', { name: /Lanterns over Halcyon/ }).first().click();
  await page.screenshot({ path: 'test-results/gate7/onboarding.png' });
  await page.getByRole('button', { name: 'Save my taste' }).click();

  const cards = page.getByRole('article');
  await expect(cards.first()).toBeVisible();
  await expect(page.getByText(/results · ranked by meaning/)).toBeVisible();
  await page.getByLabel('Describe what you want').fill('quiet stories about the sea and memory');
  await page.getByRole('button', { name: 'Discover', exact: true }).click();
  await expect(page.getByText(/results · ranked by meaning/)).toBeVisible();
  await page.screenshot({ path: 'test-results/gate7/discover.png' });

  const book = cards.filter({ hasText: 'Book' }).first();
  const title = await book.getByRole('heading').textContent();
  await book.getByRole('button', { name: '+ To read' }).click();
  await expect(page.getByText(`“${title}” added to your Library · To read`)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Saved titles' })).toBeVisible();

  await cards.first().getByRole('button', { name: 'Why this?' }).click();
  const drawer = page.getByRole('dialog', { name: 'Why this?' });
  await expect(drawer.getByRole('progressbar').first()).toBeVisible();
  await expect(drawer.getByRole('heading', { name: /Related (films|books)/ })).toBeVisible();
  await drawer.getByRole('button', { name: 'Explain in words' }).click();
  await expect(drawer.getByRole('region', { name: 'Explanation in words' }).getByText(/ranked here mostly on/)).toBeVisible();
  await page.screenshot({ path: 'test-results/gate7/why-this.png' });
  await page.keyboard.press('Escape');

  await page.goto('/app/library');
  await expect(page.getByText(title).first()).toBeVisible();

  await page.goto('/app/discover/recommendation-lab');
  await expect(page.getByRole('heading', { level: 1, name: 'Recommendation Lab' })).toBeVisible();
  const list = page.getByRole('table', { name: 'Re-ranked titles' });
  await expect(list.getByRole('row').nth(5)).toBeVisible();
  await page.getByLabel('Theme overlap').fill('1');
  await page.getByLabel('Relevance vs diversity (λ)').fill('0.3');
  await expect(page.getByText(/3 · Diversity \(MMR, λ = 0\.3\)/)).toBeVisible();
  await expect(list.locator('.rank-up, .rank-down').first()).toBeVisible();
  const evaluation = page.getByRole('region', { name: 'Offline evaluation' });
  await evaluation.getByRole('button', { name: 'Run evaluation' }).click();
  await expect(evaluation.getByRole('table', { name: 'Offline evaluation at K=10' })).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: 'test-results/gate7/lab.png', fullPage: true });

  await page.goto('/app/studio?view=evaluations');
  await expect(page.getByRole('region', { name: 'Offline evaluation' }).getByRole('table')).toBeVisible();
});
