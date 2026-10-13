import { test, expect } from './fixtures.js';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (e) => {
    throw e;
  });
});

// Gate 8 in a real browser: run view with RAG X-Ray, time machine and tutor, a fork, the Retrieval Playground
// with failure injection, Compare, a blind Model Battle and a RAG evaluation with the cost-vs-quality scatter.
// Screenshots go to test-results/gate8 for review.
test('gate 8 AI studio', async ({ page, fakeApi }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const seeded = fakeApi.ai.ai.runs[0];
  await page.goto(`/app/studio/runs/${seeded.id}`);
  await expect(page.getByRole('group', { name: /LangGraph workflow grounded_qa/ })).toBeVisible();
  await page.getByRole('button', { name: 'Replay (free)' }).click();
  await expect(page.getByRole('button', { name: /Replaying/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Replay (free)' })).toBeVisible({ timeout: 10_000 });

  await page.getByRole('tab', { name: 'RAG X-Ray' }).click();
  await expect(page.getByRole('table', { name: 'Retrieval candidates' }).getByRole('row')).toHaveCount(9);
  await page.screenshot({ path: 'test-results/gate8/xray.png' });
  await page.getByRole('tab', { name: 'Tutor' }).click();
  await expect(page.getByRole('heading', { name: /Tier T1/ })).toBeVisible();
  await page.getByRole('tab', { name: 'Time machine' }).click();
  await page.getByRole('button', { name: /#1 before generate/ }).click();
  await expect(page.getByRole('table', { name: 'State changes at this checkpoint' })).toBeVisible();
  await page.screenshot({ path: 'test-results/gate8/time-machine.png' });
  await page.getByRole('button', { name: 'Fork from here…' }).click();
  await page.getByRole('dialog', { name: 'Fork from step 1' }).getByRole('button', { name: 'Start fork' }).click();
  await expect(page.getByRole('link', { name: 'Compare with parent' })).toBeVisible();
  await page.getByRole('link', { name: 'Compare with parent' }).click();
  await expect(page.getByRole('article', { name: /^Run / })).toHaveCount(2);
  await page.screenshot({ path: 'test-results/gate8/compare.png' });

  await page.goto('/app/studio/playground');
  const form = page.getByRole('form', { name: 'Playground settings' });
  await form.getByLabel('Question').fill('How many organisations did the survey cover?');
  await form.getByLabel('Fusion').selectOption('sparse');
  await form.getByRole('button', { name: 'Run in the lab' }).click();
  await expect(page.getByRole('article', { name: 'Lab answer' }).getByText(/412 organisations/)).toBeVisible();
  await expect(page.getByRole('table', { name: 'Retrieval candidates' })).toBeVisible();
  await page.screenshot({ path: 'test-results/gate8/playground.png', fullPage: true });
  await form.getByLabel(/^Failure injection/).selectOption('retrieval_down');
  await form.getByRole('button', { name: 'Run in the lab' }).click();
  await expect(page.getByText(/vector store is unavailable/)).toBeVisible();

  await page.goto('/app/studio/battles');
  const battle = page.getByRole('form', { name: 'New battle' });
  await battle.getByRole('checkbox', { name: /Mock grounded model/ }).check();
  await battle.getByRole('checkbox', { name: /Mock concise model/ }).check();
  await battle.getByRole('button', { name: /Start battle/ }).click();
  await expect(page.getByRole('article', { name: 'Answer B' })).toBeVisible();
  await page.screenshot({ path: 'test-results/gate8/battle-blind.png' });
  await page.getByRole('button', { name: 'B is better' }).click();
  await expect(page.getByRole('article', { name: 'Answer B' }).getByText('Winner')).toBeVisible();
  await page.screenshot({ path: 'test-results/gate8/battle-revealed.png' });

  await page.goto('/app/studio/evaluations');
  const ev = page.getByRole('form', { name: 'Run a RAG evaluation' });
  await ev.getByRole('checkbox', { name: /judge model/ }).check();
  await ev.getByRole('button', { name: 'Run 4 questions' }).click();
  await expect(page.getByRole('table', { name: 'Per-question results' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Cost versus quality/ }).locator('.recharts-symbols')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/gate8/evaluations.png', fullPage: true });
});
