import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '@/test/render.jsx';
import { createFakeApi, installFakeFetch } from '@/test/fakeApi.js';
import { LANTERNS } from '@/test/fakeLibrary.js';
import { chapterFor, locatorLabel, percentOf } from './locator.js';

// epub.js needs real layout; this engine renders the synthetic book's chapters with the same props and handle.
vi.mock('./ReaderEngine.jsx', async () => {
  const React = await import('react');
  const { LANTERNS: book } = await import('@/test/fakeLibrary.js');
  const cfiOf = (i, tail = '/4/2/1:0') => `epubcfi(/6/${2 * (i + 1)}[${book.chapters[i].idref}]!${tail})`;
  const indexOf = (target) => {
    const s = typeof target === 'string' ? target : (target?.locations?.cfi ?? target?.href ?? '');
    const i = book.chapters.findIndex((c) => s.includes(`[${c.idref}]`) || s.split('#')[0] === c.href);
    return i < 0 ? null : i;
  };
  const ReaderEngine = React.forwardRef(function FakeEngine({ initial, highlights, prefs, onReady, onRelocate, onSelect }, ref) {
    const [i, setI] = React.useState(() => indexOf(initial) ?? 0);
    React.useImperativeHandle(ref, () => ({
      goTo: (t) => indexOf(t) != null && setI(indexOf(t)),
      next: () => setI((x) => Math.min(book.chapters.length - 1, x + 1)),
      prev: () => setI((x) => Math.max(0, x - 1)),
    }));
    React.useEffect(() => onReady({ toc: book.chapters.map((c) => ({ href: c.href, label: c.title, depth: 0 })) }), []); // eslint-disable-line react-hooks/exhaustive-deps
    const ch = book.chapters[i];
    React.useEffect(() => {
      onRelocate({ href: ch.href, type: 'application/xhtml+xml', title: ch.title, locations: { cfi: cfiOf(i), progression: 0, totalProgression: i / book.chapters.length } });
    }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
    const painted = highlights.filter((h) => indexOf(h.locator) === i);
    return (
      <div role="document" aria-label="Book text" data-font={prefs.font} data-size={prefs.fontSize}>
        <h2>{ch.title}</h2>
        {ch.paragraphs.map((p, j) => (
          <p
            key={j}
            onMouseUp={() =>
              onSelect({
                text: p.slice(0, 60),
                rect: { left: 100, top: 100, bottom: 120, width: 100 },
                locator: { href: ch.href, type: 'application/xhtml+xml', title: ch.title, locations: { cfi: cfiOf(i, `/4/${2 * (j + 2)},/1:0,/1:60`) }, text: { highlight: p.slice(0, 60) } },
                clear() {},
              })
            }
          >
            {p}
          </p>
        ))}
        <ul aria-label="Painted highlights">
          {painted.map((h) => (
            <li key={h.id} data-color={h.color}>
              {h.id}
            </li>
          ))}
        </ul>
      </div>
    );
  });
  return { ReaderEngine };
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const itemOf = (fake) => fake.db.library.items.find((i) => i.sourceId);
const bar = () => screen.getByRole('region', { name: 'Reader' });
const side = () => screen.getByRole('complementary', { name: 'Notes and AI' });

async function openReader(opts, query = '') {
  const fake = installFakeFetch(createFakeApi(opts));
  if (opts?.viewer) fake.db.memberships[0].role = 'VIEWER';
  const router = renderApp(`/app/library/books/${itemOf(fake).id}/read${query}`);
  await screen.findByRole('heading', { level: 1, name: 'Orbit of Small Lanterns' });
  await screen.findByRole('document', { name: 'Book text' });
  return { fake, router };
}

async function select(text) {
  fireEvent.mouseUp(await screen.findByText((t) => t.startsWith(text)));
  return screen.findByRole('dialog', { name: 'Folio Lens' });
}

describe('locator helpers', () => {
  const chapters = LANTERNS.chapters;
  it('labels and places positions', () => {
    const loc = { href: 'chapter-3.xhtml', locations: { totalProgression: 0.506 } };
    expect(chapterFor(chapters, loc)?.page).toBe(3);
    expect(locatorLabel(chapters, loc)).toBe('Chapter 3 — A Lantern Fails');
    expect(locatorLabel(chapters, { type: 'application/pdf', locations: { page: 7 } })).toBe('p. 7');
    expect(percentOf(loc)).toBe(51);
    expect(percentOf({ locations: { totalProgression: 3 } })).toBe(100);
  });
});

describe('Reader', () => {
  it('opens at the saved position with contents, notes and bookmarks', async () => {
    await openReader();
    expect(await screen.findByRole('heading', { level: 2, name: 'Chapter 2 — The Archivist' })).toBeInTheDocument();
    const toc = screen.getByRole('list', { name: 'Table of contents' });
    expect(within(toc).getAllByRole('button')).toHaveLength(4);
    expect(within(toc).getByRole('button', { name: /The Archivist/ })).toHaveAttribute('aria-current', 'true');
    expect(within(toc).getByRole('button', { name: /The Halcyon Ring/ })).toHaveTextContent('✓');
    expect(within(bar()).getByText(/Chapter 2 — The Archivist · 25%/)).toBeInTheDocument();
    const notes = within(side()).getByRole('list', { name: 'Highlights and notes' });
    expect(within(notes).getByText(/Who lights them\?/)).toBeInTheDocument();
    expect(within(side()).getByRole('list', { name: 'Bookmarks' })).toHaveTextContent('Chapter 1 — The Halcyon Ring');
  });

  it('honours a ?cfi= deep link from a research note', async () => {
    await openReader(undefined, `?cfi=${encodeURIComponent('epubcfi(/6/6[chapter_2]!/4/2,/1:0,/1:40)')}`);
    expect(await screen.findByRole('heading', { level: 2, name: 'Chapter 3 — A Lantern Fails' })).toBeInTheDocument();
  });

  it('applies and remembers typography preferences', async () => {
    await openReader();
    fireEvent.click(screen.getByRole('button', { name: /Reader settings/ }));
    const settings = screen.getByRole('group', { name: 'Reader settings' });
    fireEvent.click(within(within(settings).getByRole('group', { name: 'Theme' })).getByRole('button', { name: 'Sepia' }));
    fireEvent.click(within(within(settings).getByRole('group', { name: 'Typeface' })).getByRole('button', { name: 'Sans' }));
    fireEvent.change(within(settings).getByRole('slider', { name: 'Text size' }), { target: { value: '21' } });
    const reader = document.querySelector('.reader');
    expect(reader).toHaveAttribute('data-rt', 'sepia');
    expect(reader.style.getPropertyValue('--r-fs')).toBe('21px');
    expect(reader.style.getPropertyValue('--r-w')).toBe('62ch');
    expect(screen.getByRole('document', { name: 'Book text' })).toHaveAttribute('data-font', 'sans');
    expect(JSON.parse(localStorage.getItem('fv-reader-prefs'))).toMatchObject({ theme: 'sepia', font: 'sans', fontSize: 21 });
  });

  it('navigates by contents and saves progress with reading time', async () => {
    const { fake } = await openReader();
    fireEvent.click(within(screen.getByRole('list', { name: 'Table of contents' })).getByRole('button', { name: /A Lantern Fails/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Chapter 3 — A Lantern Fails' })).toBeInTheDocument();
    await waitFor(() => expect(fake.db.library.progress[0]).toMatchObject({ chapterIndex: 2, percent: 0.5 }), { timeout: 4000 });
    expect(fake.db.library.progress[0].locator.href).toBe('chapter-3.xhtml');
    fireEvent.click(within(bar()).getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Chapter 4 — Perihelion' })).toBeInTheDocument();
  });

  it('highlights a selection, recolours and deletes it, and syncs a change from another device', async () => {
    const { fake } = await openReader();
    const lens = await select('Teodor Lusk');
    expect(within(lens).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Define', 'Explain', 'Summarize passage', 'Highlight', 'Add note', 'Save as excerpt']);
    fireEvent.click(within(lens).getByRole('menuitem', { name: 'Highlight' }));

    await waitFor(() => expect(fake.db.library.annotations).toHaveLength(2));
    const created = fake.db.library.annotations.at(-1);
    expect(created.id).toMatch(UUID);
    expect(created).toMatchObject({ kind: 'HIGHLIGHT', color: 'amber', quote: expect.stringMatching(/^Teodor Lusk/) });
    expect(created.locator.locations.cfi).toContain('[chapter_1]');
    expect(within(screen.getByRole('list', { name: 'Painted highlights' })).getByText(created.id)).toBeInTheDocument();

    const notes = within(side()).getByRole('list', { name: 'Highlights and notes' });
    const row = (await within(notes).findByText(/Teodor Lusk/)).closest('li');
    fireEvent.click(within(within(row).getByRole('group', { name: 'Highlight colour' })).getByRole('button', { name: 'sky' }));
    await waitFor(() => expect(created.color).toBe('sky'));

    // Another device deletes the seeded note; a focus sync pulls the tombstone.
    const seeded = fake.db.library.annotations[0];
    seeded.deletedAt = seeded.updatedAt = new Date(Date.now() + 1000).toISOString();
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(within(notes).queryByText(/Who lights them\?/)).not.toBeInTheDocument());

    fireEvent.click(within(row).getByRole('button', { name: 'Delete highlight' }));
    await waitFor(() => expect(created.deletedAt).not.toBeNull());
    expect(within(side()).getByText('Nothing yet. Select text and choose Highlight or Add note.')).toBeInTheDocument();
  });

  it('adds a note to a passage', async () => {
    const { fake } = await openReader();
    fireEvent.click(within(await select('He showed Ilse')).getByRole('menuitem', { name: 'Add note' }));
    const form = await screen.findByRole('form', { name: 'New note' });
    fireEvent.change(within(form).getByLabelText('Note text'), { target: { value: 'Perihelion every 91 days.' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(fake.db.library.annotations.at(-1)).toMatchObject({ kind: 'NOTE', note: 'Perihelion every 91 days.' }));
    expect(within(side()).getByText('✎ Perihelion every 91 days.')).toBeInTheDocument();
  });

  it('explains a passage with a spoiler-guarded, cited answer (DEMO model)', async () => {
    const { fake } = await openReader();
    fireEvent.click(within(await select('Teodor Lusk')).getByRole('menuitem', { name: 'Explain' }));
    const panel = await screen.findByRole('region', { name: 'Explanation of the selected passage' });
    expect(await within(panel).findByText(/sets up the mystery of who tends the lanterns/)).toBeInTheDocument();
    expect(within(panel).getByText('DEMO')).toBeInTheDocument();
    await waitFor(() => expect(within(panel).getByRole('button', { name: /Citation S1/ })).toBeEnabled());
    expect(within(panel).getByText(/Context sent: Chapter 2 — The Archivist up to the end of your selection, 1 earlier chapter summary and 1 earlier passage\. Later\s+chapters are never sent\./)).toBeInTheDocument();
    expect(panel).not.toHaveTextContent('Rhea');

    const run = fake.db.ai.runs.at(-1);
    expect(run).toMatchObject({ graph: 'passage_explain', tier: 'T0', input: { params: { mode: 'explain', page: 2, chapterTitle: 'Chapter 2 — The Archivist', itemId: itemOf(fake).id } } });
    expect(run.scope.sourceVersionIds).toEqual([fake.db.sources.find((s) => s.title.endsWith('.epub')).currentVersionId]);

    fireEvent.click(within(panel).getByRole('button', { name: /Citation S1/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Chapter 2 — The Archivist' })).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Close explanation' }));
    expect(screen.queryByRole('region', { name: 'Explanation of the selected passage' })).not.toBeInTheDocument();
  });

  it('asks a question about a passage from the Lens', async () => {
    const { fake } = await openReader();
    const lens = await select('Teodor Lusk');
    fireEvent.change(within(lens).getByLabelText('Ask about the selection'), { target: { value: 'Who is Teodor?' } });
    fireEvent.click(within(lens).getByRole('button', { name: 'Ask' }));
    const panel = await screen.findByRole('region', { name: 'Answer of the selected passage' });
    expect(within(panel).getByText('Q: Who is Teodor?')).toBeInTheDocument();
    await within(panel).findByText(/has not answered “Who is Teodor\?” yet/);
    expect(fake.db.ai.runs.at(-1).input.params).toMatchObject({ mode: 'ask', question: 'Who is Teodor?' });
  });

  it('saves a passage as an excerpt for Writer research notes', async () => {
    const { fake } = await openReader();
    fireEvent.click(within(await select('Teodor Lusk')).getByRole('menuitem', { name: 'Save as excerpt' }));
    await screen.findByText('Saved as an excerpt. Add it to a manuscript from Writer → Research.');
    const e = fake.writer.writer.excerpts.at(-1);
    expect(e).toMatchObject({ title: 'Orbit of Small Lanterns', quote: expect.stringMatching(/^Teodor Lusk/), anchor: { itemId: itemOf(fake).id, page: 2, chapterTitle: 'Chapter 2 — The Archivist' } });
  });

  it('bookmarks the current chapter and removes the bookmark', async () => {
    const { fake } = await openReader();
    const button = await within(bar()).findByRole('button', { name: 'Bookmark' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    expect(await within(bar()).findByRole('button', { name: 'Bookmarked' })).toHaveAttribute('aria-pressed', 'true');
    expect(fake.db.library.bookmarks.at(-1)).toMatchObject({ label: 'Chapter 2 — The Archivist' });
    fireEvent.click(within(bar()).getByRole('button', { name: 'Bookmarked' }));
    await within(bar()).findByRole('button', { name: 'Bookmark' });
    expect(fake.db.library.bookmarks).toHaveLength(1);
  });

  it('gives viewers highlights and notes but no AI or excerpts', async () => {
    await openReader({ viewer: true });
    const lens = await select('Teodor Lusk');
    expect(within(lens).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Highlight', 'Add note']);
    expect(within(lens).queryByLabelText('Ask about the selection')).not.toBeInTheDocument();
  });

  it('shows a not-found page for a book that is not on the shelf', async () => {
    renderApp('/app/library/books/00000000-0000-4000-8000-999999999999/read');
    expect(await screen.findByRole('heading', { level: 1, name: 'Book not found' })).toBeInTheDocument();
  });
});
