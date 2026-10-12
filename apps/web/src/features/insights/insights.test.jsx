import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import contract from '@folioverse/contracts/fixtures/insight-actions.json';
import { renderApp } from '@/test/render.jsx';
import { createFakeApi, installFakeFetch } from '@/test/fakeApi.js';
import { FAKE_INSIGHT_ACTIONS, scriptedArtifact } from '@/test/fakeKnowledge.js';
import { pageParagraphs, paragraphId } from '../documents/anchors.js';
import { layoutMap } from './KnowledgeMap.jsx';
import { searchHref } from './search.js';

vi.mock('../documents/PdfViewer.jsx', () => ({
  default: () => <div role="region" aria-label="PDF preview" />,
}));

// React Flow needs real layout; the canvas is covered by layoutMap and the accessible list.
vi.mock('./KnowledgeMap.jsx', async (orig) => {
  const mod = await orig();
  return {
    ...mod,
    default: ({ nodes, onCite }) => (
      <ul aria-label="Knowledge map concepts">
        {nodes.map((n) => (
          <li key={n.id}>
            <button type="button" onClick={() => onCite?.(n.marker)}>
              {n.label}
            </button>
          </li>
        ))}
      </ul>
    ),
  };
});

Range.prototype.getBoundingClientRect ??= () => ({ left: 100, top: 100, bottom: 120, right: 200, width: 100, height: 20, x: 100, y: 100, toJSON() {} });

const outlook = (fake) => fake.db.sources.find((s) => s.title === 'Market Outlook 2026.pdf');
const docUrl = (fake) => `/app/knowledge/projects/${outlook(fake).projectId}/documents/${outlook(fake).id}`;

async function openDocument(opts = {}) {
  const fake = installFakeFetch(createFakeApi(opts));
  const router = renderApp(docUrl(fake));
  await screen.findByRole('heading', { level: 1, name: 'Market Outlook 2026.pdf' });
  return { fake, router };
}

/** Radix tabs activate on mouse down. */
const openTab = (name) => fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false });
const openMenu = (trigger) => fireEvent.keyDown(trigger, { key: 'Enter' });

describe('insight registry and fakes', () => {
  it('serves the contract registry and scripts an artifact for every action', () => {
    expect(FAKE_INSIGHT_ACTIONS).toEqual(contract.actions);
    for (const a of FAKE_INSIGHT_ACTIONS) {
      const s = scriptedArtifact(a);
      expect(['markdown', 'json']).toContain(s.format);
      expect(JSON.stringify(s.content)).toMatch(/\[S1\]|"marker":"S1"/);
    }
  });

  it('numbers paragraphs by blank lines with exact offsets', () => {
    const text = 'Intro line\n\n  Second para\nwraps here\n\n\nThird';
    const paras = pageParagraphs(text);
    expect(paras.map((p) => p.text)).toEqual(['Intro line', 'Second para\nwraps here', 'Third']);
    for (const p of paras) expect(text.slice(p.start, p.end)).toBe(p.text);
    expect(paragraphId(3, 1)).toBe('p-3-1');
  });

  it('lays out a knowledge map top-down and drops dangling edges', () => {
    const { nodes, edges } = layoutMap(
      [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B', marker: 'S1' },
      ],
      [
        { source: 'a', target: 'b', label: 'leads to', weight: 3 },
        { source: 'a', target: 'missing' },
      ],
    );
    expect(edges).toHaveLength(1);
    expect(nodes.find((n) => n.id === 'b').position.y).toBeGreaterThan(nodes.find((n) => n.id === 'a').position.y);
    expect(nodes[1].data).toEqual({ label: 'B', marker: 'S1' });
  });

  it('links search results to the right page', () => {
    expect(searchHref({ type: 'project', projectId: 'p' })).toBe('/app/knowledge/projects/p');
    expect(searchHref({ type: 'artifact', id: 'a', projectId: 'p' })).toBe('/app/knowledge/projects/p/artifacts/a');
    expect(searchHref({ type: 'passage', id: 'c', projectId: 'p', sourceId: 's' })).toBe('/app/knowledge/projects/p/documents/s');
  });
});

describe('insights on a document', () => {
  it('runs a summary, streams it with citations and saves an artifact', async () => {
    const { fake } = await openDocument();
    openTab('Insights');
    const panel = await screen.findByRole('tabpanel', { name: 'Insights' });
    fireEvent.click(await within(panel).findByRole('button', { name: 'Quick Summary' }));
    const result = await within(panel).findByRole('region', { name: 'Quick Summary result' });
    expect(await within(result).findByText(/the market grows 14\.2% a year/)).toBeInTheDocument();
    await waitFor(() => expect(within(result).getAllByRole('button', { name: /^Citation S1: Verified quote/ }).length).toBeGreaterThan(0));
    const link = await within(result).findByRole('link', { name: 'Open artifact' });
    const artifact = fake.db.knowledge.artifacts.at(-1);
    expect(link).toHaveAttribute('href', `/app/knowledge/projects/${artifact.projectId}/artifacts/${artifact.id}`);
    expect(artifact).toMatchObject({ kind: 'SUMMARY', action: 'quick_summary', title: 'Quick Summary · Market Outlook 2026', isDemo: true });
    expect(fake.db.ai.runs.at(-1)).toMatchObject({ graph: 'insight', tier: 'T0', input: { action: 'quick_summary' } });
    const saved = within(panel).getByRole('region', { name: 'Saved artifacts' });
    expect(await within(saved).findByRole('link', { name: 'Quick Summary · Market Outlook 2026' })).toBeInTheDocument();

    fireEvent.click(within(result).getAllByRole('button', { name: /^Citation S2: / })[0]);
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText(/Bundled office suites are the main pricing risk/)).toBeInTheDocument();
  });

  it('renders flashcards and questions interactively', async () => {
    await openDocument();
    openTab('Insights');
    const panel = await screen.findByRole('tabpanel', { name: 'Insights' });
    fireEvent.click(await within(panel).findByRole('button', { name: 'Generate Flashcards' }));
    const cards = await within(panel).findByRole('list', { name: 'Flashcards' });
    expect(within(cards).queryByText(/14\.2% a year/)).toBeNull();
    fireEvent.click(within(cards).getAllByRole('button', { name: 'Show answer' })[0]);
    expect(within(cards).getByText(/14\.2% a year/)).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'Generate Questions' }));
    const quiz = await within(panel).findByRole('list', { name: 'Questions' });
    fireEvent.click(within(quiz).getByRole('radio', { name: '9%' }));
    expect(within(quiz).getByRole('status')).toHaveTextContent(/^Not quite\. The brief states 14\.2% a year/);
  });

  it('builds a knowledge map whose concepts open their evidence', async () => {
    await openDocument();
    openTab('Insights');
    const panel = await screen.findByRole('tabpanel', { name: 'Insights' });
    fireEvent.click(await within(panel).findByRole('button', { name: 'Create Knowledge Map' }));
    const map = await within(panel).findByRole('list', { name: 'Knowledge map concepts' });
    fireEvent.click(within(map).getByRole('button', { name: 'Bundled office suites' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText(/Bundled office suites are the main pricing risk/)).toBeInTheDocument();
  });

  it('compares with another ready document in the project', async () => {
    const { fake } = await openDocument();
    openTab('Insights');
    const panel = await screen.findByRole('tabpanel', { name: 'Insights' });
    fireEvent.click(await within(panel).findByRole('button', { name: 'Compare with Another Document' }));
    expect(within(panel).getByLabelText('Compare with')).toHaveDisplayValue('Competitor Notes.md');
    fireEvent.click(within(panel).getByRole('button', { name: 'Compare' }));
    expect(await within(panel).findByText(/Only one names bundled office suites/)).toBeInTheDocument();
    const run = fake.db.ai.runs.at(-1);
    expect(run).toMatchObject({ graph: 'multi_doc_compare', input: { action: 'compare' } });
    expect(run.scope.sourceVersionIds).toHaveLength(2);
    await waitFor(() => expect(fake.db.knowledge.artifacts.at(-1)).toMatchObject({ kind: 'COMPARISON', title: 'Compare with Another Document · 2 documents', sourceId: null }));
  });

  it('keeps insight actions locked for viewers', async () => {
    const fake = installFakeFetch(createFakeApi({ role: 'VIEWER' }));
    fake.db.memberships[0].role = 'VIEWER';
    renderApp(docUrl(fake));
    await screen.findByRole('heading', { level: 1, name: 'Market Outlook 2026.pdf' });
    openTab('Insights');
    const panel = await screen.findByRole('tabpanel', { name: 'Insights' });
    expect(await within(panel).findByRole('button', { name: 'Quick Summary' })).toBeDisabled();
    expect(within(panel).getByText('Viewers can read answers but cannot ask new questions.')).toBeInTheDocument();
  });
});

describe('notes and Folio Lens', () => {
  async function selectInText(phrase) {
    fireEvent.click(within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name: 'Text' }));
    const para = await screen.findByText(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\%]/g, '\\$&')), { selector: 'span[data-text]' });
    const node = para.firstChild;
    const at = node.textContent.indexOf(phrase);
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + phrase.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.mouseUp(para);
    return screen.findByRole('dialog', { name: 'Folio Lens' });
  }

  it('adds a note from a selection and returns to its exact place', async () => {
    const { fake } = await openDocument();
    const lens = await selectInText('412 organisations');
    fireEvent.click(within(lens).getByRole('menuitem', { name: 'Add to notes' }));
    const panel = await screen.findByRole('tabpanel', { name: 'Notes' });
    expect(within(panel).getByText('“412 organisations”', { exact: false })).toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText('Note on the selected passage'), { target: { value: 'Sample size looks solid.' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Add note' }));
    const notes = await within(panel).findByRole('list', { name: 'Notes' });
    expect(within(notes).getByText('Sample size looks solid.')).toBeInTheDocument();
    const note = fake.db.knowledge.notes[0];
    expect(note).toMatchObject({ quote: '412 organisations', anchor: { sourceVersionId: outlook(fake).currentVersionId, selectors: { page: 3, textQuote: { exact: '412 organisations' } } } });

    fireEvent.click(within(notes).getByRole('button', { name: 'Show in document' }));
    const mark = await screen.findByLabelText('Cited passage', { selector: 'mark' });
    expect(mark).toHaveTextContent(/^412 organisations$/);
    expect(mark.closest('article')).toHaveAttribute('aria-label', 'Page 3');

    fireEvent.click(within(notes).getByRole('button', { name: /^Delete note: Sample size/ }));
    await waitFor(() => expect(fake.db.knowledge.notes).toHaveLength(0));
  });

  it('explains a selection through a grounded chat question', async () => {
    const { fake } = await openDocument();
    const lens = await selectInText('Bundled office suites');
    fireEvent.click(within(lens).getByRole('menuitem', { name: 'Explain selection' }));
    await waitFor(() => expect(fake.db.ai.runs.at(-1).input.question).toBe('Explain this passage in plain language: “Bundled office suites”'));
    const chat = screen.getByRole('region', { name: 'Grounded conversation' });
    expect(await within(chat).findByText(/The main pricing risk is bundled office suites/)).toBeInTheDocument();
  });

  it('defines a selected term through the grounded chat', async () => {
    const { fake } = await openDocument();
    const lens = await selectInText('Data-residency');
    fireEvent.click(within(lens).getByRole('menuitem', { name: 'Define term' }));
    await waitFor(() => expect(fake.db.ai.runs.at(-1).input.question).toBe('Define “Data-residency” as it is used in this document.'));
  });

  it('offers viewers only read-only Lens actions', async () => {
    const fake = installFakeFetch(createFakeApi({ role: 'VIEWER' }));
    fake.db.memberships[0].role = 'VIEWER';
    renderApp(docUrl(fake));
    await screen.findByRole('heading', { level: 1, name: 'Market Outlook 2026.pdf' });
    const lens = await selectInText('412 organisations');
    expect(within(lens).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Find related evidence']);
  });

  it('finds related evidence for a selection', async () => {
    await openDocument();
    const lens = await selectInText('procurement cycles exceed nine months');
    fireEvent.click(within(lens).getByRole('menuitem', { name: 'Find related evidence' }));
    const related = await within(lens).findByRole('list', { name: 'Related evidence' });
    expect(within(related).getAllByRole('button', { name: /Market Outlook 2026\.pdf · p\. 2/ }).length).toBeGreaterThan(0);
  });

  it('adds a plain note without a selection', async () => {
    const { fake } = await openDocument();
    openTab('Notes');
    const panel = await screen.findByRole('tabpanel', { name: 'Notes' });
    fireEvent.change(within(panel).getByLabelText('New note'), { target: { value: 'Check the regional split.' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Add note' }));
    expect(await within(panel).findByText('Check the regional split.')).toBeInTheDocument();
    expect(fake.db.knowledge.notes[0]).toMatchObject({ anchor: null, quote: null, sourceId: outlook(fake).id });
  });
});

describe('conversation management', () => {
  it('attaches another document to a conversation scope', async () => {
    const { fake } = await openDocument();
    const chat = screen.getByRole('region', { name: 'Grounded conversation' });
    const scope = within(chat).getByRole('group', { name: 'Conversation scope' });
    await within(scope).findByText('Market Outlook 2026');
    fireEvent.click(await within(chat).findByRole('button', { name: '+ Add document' }));
    fireEvent.change(within(chat).getByLabelText('Document to add'), { target: { value: fake.db.sources.find((s) => s.title === 'Competitor Notes.md').id } });
    expect(await within(scope).findByText('Competitor Notes')).toBeInTheDocument();
    const thread = fake.db.ai.threads[0];
    expect(thread.scope).toHaveLength(2);

    fireEvent.click(within(scope).getByRole('button', { name: 'Remove Competitor Notes.md from this conversation' }));
    await waitFor(() => expect(fake.db.ai.threads[0].scope).toHaveLength(1));
  });

  it('renames and archives a conversation, then restores it', async () => {
    const { fake } = await openDocument();
    const chat = screen.getByRole('region', { name: 'Grounded conversation' });
    await within(chat).findByText(/compound annual rate of 14\.2%/);
    openMenu(within(chat).getByRole('button', { name: 'Conversation options' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename conversation' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename conversation' });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Growth questions' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fake.db.ai.threads[0].title).toBe('Growth questions'));

    openMenu(within(chat).getByRole('button', { name: 'Conversation options' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Archive conversation' }));
    await waitFor(() => expect(fake.db.ai.threads[0].archivedAt).not.toBeNull());

    openMenu(within(chat).getByRole('button', { name: 'Conversation options' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'All conversations…' }));
    const all = await screen.findByRole('dialog', { name: 'Conversations about this document' });
    fireEvent.click(within(all).getByLabelText('Archived'));
    fireEvent.click(await within(all).findByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(fake.db.ai.threads[0].archivedAt).toBeNull());
  });
});

describe('artifact page', () => {
  async function openArtifact(opts = {}) {
    const fake = installFakeFetch(createFakeApi({ artifacts: ['key_facts'], ...opts }));
    const a = fake.db.knowledge.artifacts[0];
    const router = renderApp(`/app/knowledge/projects/${a.projectId}/artifacts/${a.id}`);
    await screen.findByRole('heading', { level: 1, name: a.title });
    return { fake, router, a };
  }

  it('shows the pinned version, content and citations', async () => {
    const { fake } = await openArtifact();
    const pins = screen.getByRole('region', { name: 'Built from' });
    expect(within(pins).getByRole('link', { name: 'Market Outlook 2026.pdf' })).toHaveAttribute('href', docUrl(fake));
    expect(within(pins).getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('DEMO')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /^Citation S1: Verified quote/ })[0]);
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText(/annual rate of 14\.2% between 2026 and 2030\./)).toBeInTheDocument();
  });

  it('opens the cited passage in the document', async () => {
    const { router } = await openArtifact();
    fireEvent.click(screen.getAllByRole('button', { name: /^Citation S2: / })[0]);
    const drawer = await screen.findByRole('dialog');
    fireEvent.click(within(drawer).getByRole('button', { name: /Open at location/ }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/documents\//));
    expect(await screen.findByRole('heading', { level: 1, name: 'Market Outlook 2026.pdf' })).toBeInTheDocument();
  });

  it('flags a stale artifact after a new version and regenerates on the current one', async () => {
    const fake = installFakeFetch(createFakeApi({ artifacts: ['quick_summary'] }));
    const s = outlook(fake);
    const v2 = { ...fake.db.versions.find((v) => v.id === s.currentVersionId), id: 'v2-outlook', versionNo: 2 };
    fake.db.versions.push(v2);
    s.currentVersionId = v2.id;
    fake.ai.knowledge.markStale(s.id, v2.id);
    const a = fake.db.knowledge.artifacts[0];
    renderApp(`/app/knowledge/projects/${a.projectId}/artifacts/${a.id}`);
    expect(await screen.findByText(/A newer version of a source document exists/)).toBeInTheDocument();
    expect(screen.getByText('Not current')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate on current version' }));
    await waitFor(() => expect(fake.db.ai.runs.at(-1).scope.sourceVersionIds).toEqual(['v2-outlook']));
  });

  it('renames, archives and deletes', async () => {
    const { fake, router, a } = await openArtifact();
    openMenu(screen.getByRole('button', { name: 'Artifact options' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename artifact' });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Atlas facts' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Atlas facts' })).toBeInTheDocument();

    openMenu(screen.getByRole('button', { name: 'Artifact options' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    expect(await screen.findByText('Archived')).toBeInTheDocument();

    openMenu(screen.getByRole('button', { name: 'Artifact options' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete artifact' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/knowledge/projects/${a.projectId}`));
    expect(fake.db.knowledge.artifacts).toHaveLength(0);
  });

  it('lists artifacts on the project page', async () => {
    const fake = installFakeFetch(createFakeApi({ artifacts: ['flashcards'] }));
    renderApp(`/app/knowledge/projects/${outlook(fake).projectId}`);
    const section = await screen.findByRole('region', { name: 'Artifacts' });
    expect(await within(section).findByRole('link', { name: 'Generate Flashcards · Market Outlook 2026' })).toBeInTheDocument();
    expect(within(section).getByText('Flashcards', { selector: '.badge' })).toBeInTheDocument();
  });
});

describe('search', () => {
  it('groups keyword matches and semantic passages', async () => {
    installFakeFetch(createFakeApi({ artifacts: ['quick_summary'] }));
    renderApp('/app/search?q=outlook');
    await screen.findByRole('heading', { level: 1, name: 'Search' });
    const docs = await screen.findByRole('region', { name: 'Documents' });
    expect(within(docs).getByRole('link', { name: 'Market Outlook 2026.pdf' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Artifacts' })).getByRole('link', { name: 'Quick Summary · Market Outlook 2026' })).toBeInTheDocument();
    const passages = screen.getByRole('region', { name: 'Passages' });
    expect(within(passages).getAllByText('Regional outlook').length).toBeGreaterThan(0);
  });

  it('searches the workspace from the command palette', async () => {
    installFakeFetch();
    const router = renderApp('/app');
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    fireEvent.click(screen.getByRole('button', { name: 'Search or run a command (Ctrl K)' }));
    const input = await screen.findByLabelText('Search commands');
    fireEvent.change(input, { target: { value: 'Competitor' } });
    const hit = await screen.findByRole('option', { name: /Competitor Notes\.md/ });
    expect(screen.getByRole('option', { name: 'Search everywhere for “Competitor”' })).toBeInTheDocument();
    fireEvent.click(hit);
    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/documents\//));
  });
});

describe('version changes', () => {
  it('summarises text changes against the previous version', async () => {
    const fake = installFakeFetch(createFakeApi());
    const s = outlook(fake);
    const v2 = { ...fake.db.versions.find((v) => v.id === s.currentVersionId), id: 'v2-outlook', versionNo: 2 };
    fake.db.versions.push(v2);
    s.currentVersionId = v2.id;
    renderApp(docUrl(fake));
    expect(await screen.findByText('No text changes since v1.')).toBeInTheDocument();
  });
});
