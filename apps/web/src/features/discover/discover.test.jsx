import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '@/test/render.jsx';
import { createFakeApi, installFakeFetch } from '@/test/fakeApi.js';
import { factorBars, rankShift, saveLabel } from './queries.js';

afterEach(() => vi.restoreAllMocks());

const cards = () => screen.getAllByRole('article');
const cardTitled = (title) => cards().find((a) => within(a).queryByRole('heading', { name: title }));

/** Opens Discover and completes onboarding with a genre, a mood and two favourites. */
async function onboard(fake = createFakeApi()) {
  installFakeFetch(fake);
  const router = renderApp('/app/discover');
  await screen.findByRole('heading', { level: 1, name: 'Find your next story' });
  await screen.findByRole('heading', { name: 'Tell us what you like' });
  fireEvent.click(within(screen.getByRole('group', { name: 'Genres' })).getByRole('button', { name: 'Sci-fi' }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Moods' })).getByRole('button', { name: 'Atmospheric' }));
  const favourites = screen.getByRole('group', { name: 'Favourites' });
  fireEvent.click(within(favourites).getAllByRole('button', { name: /Lanterns over Halcyon/ })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Save my taste' }));
  return { fake, router };
}

describe('discover helpers', () => {
  it('orders factor bars by contribution and computes rank movement', () => {
    const bars = factorBars({ factors: [{ key: 'a', value: 0.5, weight: 0.2 }, { key: 'b', value: 0.4, weight: 0.5, contribution: 0.2 }] });
    expect(bars.map((b) => b.key)).toEqual(['b', 'a']);
    expect(bars[1].contribution).toBeCloseTo(0.1);
    const prev = { items: [{ itemId: 'x', rank: 1 }, { itemId: 'y', rank: 2 }] };
    const next = { items: [{ itemId: 'y', rank: 1 }, { itemId: 'x', rank: 2 }, { itemId: 'z', rank: 3 }] };
    expect(rankShift(prev, next)).toEqual({ y: 1, x: -1, z: null });
    expect(saveLabel({ kind: 'FILM', feedback: { saved: false } })).toBe('+ Watchlist');
    expect(saveLabel({ kind: 'BOOK', feedback: { saved: true } })).toBe('✓ Saved');
  });
});

describe('Discover page', () => {
  it('onboards taste, then shows logged recommendations with impressions', async () => {
    const { fake } = await onboard();
    const D = fake.db.discover;
    expect(D.tastes[0]).toMatchObject({ genres: ['Sci-fi'], moods: ['Atmospheric'] });
    expect(D.tastes[0].seedItemIds).toHaveLength(1);
    await waitFor(() => expect(cards().length).toBeGreaterThan(4));
    expect(screen.getByText(/results · ranked by meaning.*recsys-hybrid v1/)).toBeInTheDocument();
    expect(D.sets).toHaveLength(1);
    expect(D.interactions.filter((i) => i.kind === 'IMPRESSION')).toHaveLength(D.sets[0].items.length);
    // Favourites are excluded from their own recommendations only once saved/rated; seeds steer the ranking.
    expect(cards().length).toBeLessThanOrEqual(12);
  });

  it('re-ranks for a query and media filter and remembers the request', async () => {
    const { fake } = await onboard();
    await waitFor(() => expect(cards().length).toBeGreaterThan(4));
    fireEvent.change(screen.getByLabelText('Describe what you want'), { target: { value: 'the sea and grief' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discover' }));
    await waitFor(() => expect(fake.db.discover.sets).toHaveLength(2));
    expect(fake.db.discover.sets[1].query).toBe('the sea and grief');
    fireEvent.click(within(screen.getByRole('group', { name: 'Media type' })).getByRole('button', { name: 'Films' }));
    await waitFor(() => expect(fake.db.discover.sets).toHaveLength(3));
    await waitFor(() => expect(cards().every((a) => within(a).getByText('Film'))).toBe(true));
    expect(fake.db.discover.sets[2].filters.kind).toBe('FILM');
  });

  it('explains a recommendation with its logged signals, related titles and a rec_explain run', async () => {
    const { fake } = await onboard();
    await waitFor(() => expect(cards().length).toBeGreaterThan(4));
    const first = cards()[0];
    const title = within(first).getByRole('heading').textContent;
    fireEvent.click(within(first).getByRole('button', { name: 'Why this?' }));
    const drawer = await screen.findByRole('dialog', { name: 'Why this?' });
    expect(within(drawer).getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
    expect(within(drawer).getByRole('progressbar', { name: /Semantic affinity/ })).toBeInTheDocument();
    expect(within(drawer).getByRole('heading', { name: /Related (films|books)/ })).toBeInTheDocument();
    expect(within(drawer).getAllByText(/× 0\.\d+ = \+0\.\d+/).length).toBeGreaterThan(0);
    await waitFor(() => expect(fake.db.discover.interactions.some((i) => i.kind === 'CLICK')).toBe(true));

    fireEvent.click(within(drawer).getByRole('button', { name: 'Explain in words' }));
    const words = await within(drawer).findByRole('region', { name: 'Explanation in words' });
    expect(await within(words).findByText(new RegExp(`“${title}” ranked here mostly on`))).toBeInTheDocument();
    expect(fake.db.ai.runs.at(-1)).toMatchObject({ graph: 'rec_explain', tier: 'T0' });
    expect(within(words).getByText('DEMO')).toBeInTheDocument();
  });

  it('saves a book to the Library “To read” shelf and hides dismissed titles', async () => {
    const { fake } = await onboard();
    await waitFor(() => expect(cards().length).toBeGreaterThan(4));
    const book = cards().find((a) => within(a).queryByText('Book'));
    const bookTitle = within(book).getByRole('heading').textContent;
    fireEvent.click(within(book).getByRole('button', { name: '+ To read' }));
    await screen.findByText(`“${bookTitle}” added to your Library · To read`);
    expect(within(cardTitled(bookTitle)).getByRole('button', { name: '✓ Saved' })).toHaveAttribute('aria-pressed', 'true');
    const shelved = fake.db.library.items.at(-1);
    expect(shelved).toMatchObject({ status: 'TO_READ' });
    expect(fake.db.library.books.find((b) => b.id === shelved.bookId)).toMatchObject({ title: bookTitle, externalIds: { catalogId: expect.any(String) }, isDemo: true });
    expect(await screen.findByRole('list', { name: 'Saved titles' })).toBeInTheDocument();

    const other = cards().find((a) => within(a).getByRole('heading').textContent !== bookTitle);
    const otherTitle = within(other).getByRole('heading').textContent;
    fireEvent.keyDown(within(other).getByRole('button', { name: `More for ${otherTitle}` }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Not interested' }));
    await screen.findByText(`“${otherTitle}” hidden. It will not be recommended again.`);
    expect(cardTitled(otherTitle)).toBeUndefined();
  });

  it('says so when the recommender is unavailable', async () => {
    const fake = createFakeApi();
    fake.db.discover.failRecommender = true;
    await onboard(fake);
    expect(await screen.findByText(/The recommender is not available right now/)).toBeInTheDocument();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });
});

describe('Recommendation Lab', () => {
  it('re-ranks live under new weights and shows stage counts and rank movement', async () => {
    const fake = createFakeApi();
    installFakeFetch(fake);
    renderApp('/app/discover/recommendation-lab');
    await screen.findByRole('heading', { level: 1, name: 'Recommendation Lab' });
    const list = await screen.findByRole('table', { name: 'Re-ranked titles' });
    expect(within(list).getAllByRole('row').length).toBeGreaterThan(5);
    expect(screen.getByText('1 · Candidate retrieval')).toBeInTheDocument();
    expect(screen.getByText(/3 · Diversity \(MMR, λ = 0\.7\)/)).toBeInTheDocument();
    const before = fake.db.discover.sets.length;

    fireEvent.change(screen.getByLabelText('Quality prior (capped)'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Semantic affinity'), { target: { value: '0' } });
    await waitFor(() => expect(fake.db.discover.sets.length).toBeGreaterThan(before));
    const last = fake.db.discover.sets.at(-1);
    expect(last.mode).toBe('LAB');
    expect(last.weights.prior).toBeLessThanOrEqual(0.1);
    expect(fake.db.discover.interactions.filter((i) => i.setId === last.id)).toHaveLength(0);
    const weights = screen.getByRole('region', { name: 'Scoring weights' });
    await waitFor(() => expect(within(weights).getAllByText('0.100').length).toBe(1));

    fireEvent.change(screen.getByLabelText('Relevance vs diversity (λ)'), { target: { value: '0.2' } });
    await screen.findByText(/3 · Diversity \(MMR, λ = 0\.2\)/);
    expect(screen.getByRole('region', { name: 'Served model' })).toHaveTextContent('recsys-hybrid v1');
  });

  it('runs an offline evaluation and shows metrics for every variant', async () => {
    installFakeFetch(createFakeApi());
    renderApp('/app/discover/recommendation-lab');
    const panel = await screen.findByRole('region', { name: 'Offline evaluation' });
    expect(await within(panel).findByText(/No evaluation has been run on this model yet/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Run evaluation' }));
    const table = await within(panel).findByRole('table', { name: 'Offline evaluation at K=10' }, { timeout: 6000 });
    expect(within(table).getByRole('rowheader', { name: 'Hybrid + MMR (served)' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'nDCG@10' })).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(7);
    expect(within(panel).getByText(/Synthetic catalog and synthetic users \(DEMO\)/)).toBeInTheDocument();
  });

  it('keeps evaluation runs for editors and shows the same reports in Studio', async () => {
    installFakeFetch(createFakeApi());
    renderApp('/app/studio?view=evaluations');
    await screen.findByRole('heading', { level: 1, name: 'Evaluations' });
    expect(screen.getByRole('navigation', { name: 'Studio sections' }).querySelector('[aria-current="page"]')).toHaveTextContent('Evaluations');
    expect(await screen.findByRole('region', { name: 'Offline evaluation' })).toBeInTheDocument();
  });
});
