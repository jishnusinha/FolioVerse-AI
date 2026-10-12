import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '@/test/render.jsx';
import { FAKE_CSRF, createFakeApi, installFakeFetch } from '@/test/fakeApi.js';
import { useWorkspaceStore } from '@/features/auth/session.js';
import { bookPayload } from './AddBookDialog.jsx';
import { mergeAnnotations } from './queries.js';

vi.mock('@/api/client.js', async (importOriginal) => ({
  ...(await importOriginal()),
  uploadWithProgress: async (target, _file, { onProgress }) => {
    onProgress?.(40);
    const res = await fetch(target.url, { method: 'PUT', headers: { 'x-csrf-token': FAKE_CSRF } });
    if (!res.ok) throw new Error('upload failed');
    onProgress?.(100);
  },
}));

const openMenu = (trigger) => fireEvent.keyDown(trigger, { key: 'Enter' });
const books = () => screen.getByRole('list', { name: 'Books' });

async function openLibrary(opts) {
  const fake = installFakeFetch(createFakeApi(opts));
  const router = renderApp('/app/library');
  await screen.findByRole('heading', { level: 1, name: 'Library' });
  await screen.findByRole('list', { name: 'Books' });
  return { fake, router };
}

afterEach(() => vi.restoreAllMocks());

describe('library helpers', () => {
  it('builds a book payload from the form and a confirmed lookup result', () => {
    const form = { title: ' Dune ', authors: 'Frank Herbert, ', isbn13: '978-0-00-000001-9', publishedYear: '1965', publisher: '', description: '' };
    expect(bookPayload(form, null)).toEqual({ title: 'Dune', authors: ['Frank Herbert'], isbn13: '9780000000019', publishedYear: 1965 });
    const picked = { provider: 'OPEN_LIBRARY', externalIds: { openLibrary: 'OL1M' }, subjects: ['SF'], pageCount: 412, language: 'en', coverUrl: null };
    expect(bookPayload(form, picked)).toMatchObject({ metadataSource: 'OPEN_LIBRARY', externalIds: { openLibrary: 'OL1M' }, subjects: ['SF'], pageCount: 412, language: 'en' });
  });

  it('merges an annotation delta: updates replace, tombstones remove', () => {
    const a = { id: 'a', createdAt: '1', quote: 'old' };
    const b = { id: 'b', createdAt: '2' };
    const merged = mergeAnnotations([a, b], [{ ...a, quote: 'new' }, { id: 'b', deletedAt: 'x' }, { id: 'c', createdAt: '3' }]);
    expect(merged.map((x) => [x.id, x.quote])).toEqual([
      ['a', 'new'],
      ['c', undefined],
    ]);
  });
});

describe('Library page', () => {
  it('shows shelves, the book in progress and this year’s reading', async () => {
    await openLibrary();
    const shelves = screen.getByRole('list', { name: 'Shelves' });
    expect(within(shelves).getByRole('button', { name: /All books\s*4/ })).toBeInTheDocument();
    expect(within(shelves).getByRole('button', { name: /Currently reading\s*1/ })).toBeInTheDocument();
    const hero = screen.getByRole('region', { name: 'Currently reading' });
    expect(within(hero).getByRole('heading', { name: 'Orbit of Small Lanterns' })).toBeInTheDocument();
    expect(within(hero).getByRole('progressbar', { name: 'Orbit of Small Lanterns: 38% read' })).toBeInTheDocument();
    expect(within(hero).getByRole('link', { name: 'Continue reading' })).toHaveAttribute('href', expect.stringMatching(/^\/app\/library\/books\/.+\/read$/));
    expect(within(books()).getAllByRole('listitem')).toHaveLength(4);
    const year = await screen.findByRole('region', { name: 'This year' });
    expect(within(year).getByText('Notes').nextSibling).toHaveTextContent('1');
    expect(screen.getByRole('img', { name: /Read on \d+ of the last 14 days/ })).toBeInTheDocument();
  });

  it('filters by shelf, collection and text', async () => {
    await openLibrary();
    fireEvent.click(within(screen.getByRole('list', { name: 'Shelves' })).getByRole('button', { name: /Finished/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'Finished' })).toBeInTheDocument();
    expect(within(books()).getAllByRole('listitem')).toHaveLength(1);
    expect(within(books()).getByRole('listitem')).toHaveTextContent('The Cartographer of Tides');

    fireEvent.click(within(screen.getByRole('list', { name: 'Collections' })).getByRole('button', { name: /Space & archives\s*2/ }));
    expect(within(books()).getAllByRole('listitem')).toHaveLength(2);

    fireEvent.click(within(screen.getByRole('list', { name: 'Shelves' })).getByRole('button', { name: /All books/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter books' }), { target: { value: 'holt' } });
    expect(within(books()).getAllByRole('listitem')).toHaveLength(1);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter books' }), { target: { value: 'zzz' } });
    expect(screen.getByText('No books match.')).toBeInTheDocument();
  });

  it('moves a book between shelves and rates it in the list view', async () => {
    const { fake } = await openLibrary();
    openMenu(screen.getByRole('button', { name: 'Actions for Notes on Quiet Machines' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to Currently reading' }));
    await screen.findByText('Notes on Quiet Machines moved to Currently reading');
    const item = fake.db.library.items.find((i) => fake.db.library.books.find((b) => b.id === i.bookId).title === 'Notes on Quiet Machines');
    expect(item.status).toBe('READING');
    expect(item.startedAt).not.toBeNull();

    fireEvent.click(within(screen.getByRole('group', { name: 'Layout' })).getByRole('button', { name: 'List' }));
    const table = screen.getByRole('table', { name: 'Books' });
    fireEvent.click(within(within(table).getByRole('group', { name: 'Rating for The Cartographer of Tides' })).getByRole('button', { name: '4 stars' }));
    await waitFor(() => expect(fake.db.library.items.find((i) => i.status === 'FINISHED').rating).toBe(4));
    expect(within(table).getByRole('link', { name: 'Orbit of Small Lanterns' })).toBeInTheDocument();
  });

  it('creates a collection and adds a book to it', async () => {
    const { fake } = await openLibrary();
    vi.spyOn(window, 'prompt').mockReturnValue('To lend');
    fireEvent.click(screen.getByRole('button', { name: 'New collection' }));
    await screen.findByText('Collection “To lend” created');
    openMenu(screen.getByRole('button', { name: 'Actions for A Field Guide to Small Weathers' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add to To lend' }));
    await screen.findByText('Added to To lend');
    const c = fake.db.library.collections.find((x) => x.name === 'To lend');
    expect(fake.db.library.links.filter((l) => l.collectionId === c.id)).toHaveLength(1);
    expect(within(screen.getByRole('list', { name: 'Collections' })).getByRole('button', { name: /To lend\s*1/ })).toBeInTheDocument();
  });

  it('adds a book manually when metadata lookup is not configured', async () => {
    const { fake } = await openLibrary();
    fireEvent.click(screen.getByRole('button', { name: 'Add manually' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a book' });
    fireEvent.change(within(dialog).getByLabelText(/Look up by title or ISBN/), { target: { value: 'Middlemarch' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Look up' }));
    expect(await within(dialog).findByText('Metadata lookup is not configured on this server. Enter the details yourself.')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to library' }));
    expect(await within(dialog).findByText('A title is required.')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Middlemarch' } });
    fireEvent.change(within(dialog).getByLabelText(/^Authors/), { target: { value: 'George Eliot' } });
    fireEvent.change(within(dialog).getByLabelText('ISBN-13'), { target: { value: '12345' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to library' }));
    expect(await within(dialog).findByText(/ISBN-13 has 13 digits/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('ISBN-13'), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to library' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a book' })).not.toBeInTheDocument());
    await waitFor(() => expect(within(books()).getAllByRole('listitem').some((li) => li.textContent.includes('Middlemarch'))).toBe(true));
    const book = fake.db.library.books.find((b) => b.title === 'Middlemarch');
    expect(book).toMatchObject({ authors: ['George Eliot'], metadataSource: 'MANUAL' });
  });

  it('fills the form from a lookup result when a provider is enabled (DEMO)', async () => {
    const { fake } = await openLibrary({ metadata: true });
    fireEvent.click(screen.getByRole('button', { name: 'Add manually' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a book' });
    fireEvent.change(within(dialog).getByLabelText(/Look up by title or ISBN/), { target: { value: 'Lanterns' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Look up' }));
    const results = await within(dialog).findByRole('list', { name: 'Lookup results' });
    expect(within(results).getByText(/Open Library/)).toBeInTheDocument();
    fireEvent.click(within(results).getByRole('button', { name: 'Use' }));
    expect(within(dialog).getByLabelText(/^Title/)).toHaveValue('Lanterns (DEMO result)');
    expect(within(dialog).getByText('Details from Open Library. Check them before saving.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to library' }));
    await waitFor(() => expect(fake.db.library.books.find((b) => b.title === 'Lanterns (DEMO result)')).toMatchObject({ metadataSource: 'OPEN_LIBRARY', isbn13: '9780000000019', pageCount: 240 }));
  });

  it('removes a book after confirmation', async () => {
    const { fake } = await openLibrary();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    openMenu(screen.getByRole('button', { name: 'Actions for Orbit of Small Lanterns' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove from library' }));
    await screen.findByText('Removed from library');
    expect(fake.db.library.items).toHaveLength(3);
    expect(fake.db.library.annotations).toHaveLength(0);
    expect(fake.db.sources.some((s) => s.title === 'Orbit of Small Lanterns.epub')).toBe(true);
  });

  it('uploads an EPUB into the Library project and shelves it', async () => {
    const { fake } = await openLibrary();
    fireEvent.click(screen.getByRole('button', { name: 'Upload book' }));
    const dialog = await screen.findByRole('dialog', { name: 'Upload books' });
    fireEvent.change(within(dialog).getByLabelText('Choose files'), {
      target: { files: [new File(['PK'], 'Persuasion.epub', { type: 'application/epub+zip' }), new File(['x'], 'notes.docx')] },
    });
    const items = within(dialog).getByRole('list', { name: 'Files to upload' });
    expect(within(items).getByText('Not allowed')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    await within(items).findByText('Preview ready');
    await waitFor(() => expect(fake.db.library.items).toHaveLength(5));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(within(books()).getAllByRole('listitem')).toHaveLength(5));
    const added = within(books()).getAllByRole('listitem').find((li) => li.textContent.includes('Persuasion'));
    expect(added).toHaveTextContent('Preparing file…');
    const lib = fake.db.projects.find((p) => p.kind === 'LIBRARY');
    expect(fake.db.sources.find((s) => s.title === 'Persuasion.epub').projectId).toBe(lib.id);
  });

  it('keeps uploads away from viewers', async () => {
    const fake = installFakeFetch(createFakeApi({ role: 'VIEWER' }));
    useWorkspaceStore.setState({ workspaceId: fake.db.workspaces.find((w) => w.kind === 'TEAM').id });
    renderApp('/app/library');
    await screen.findByRole('heading', { level: 1, name: 'Library' });
    expect(await screen.findByText(/Your library is empty/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload book' })).toBeDisabled();
  });
});
