import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { renderApp } from '@/test/render.jsx';
import { createFakeApi, installFakeFetch } from '@/test/fakeApi.js';
import { blocksOf, citationNode, citationText, countWords, docText, replaceBlockText } from './doc.js';
import { memoryDraftStore, setDraftStore, draftKey } from './drafts.js';
import { BlockAttrs, Citation, findBlock } from './editor.js';
import { layoutStory } from './StoryGraph.jsx';
import { blockDiff, wordDiff } from './wdiff.js';

// React Flow needs real layout; the canvas is covered by layoutStory and the accessible list.
vi.mock('./StoryGraph.jsx', async (orig) => {
  const mod = await orig();
  return {
    ...mod,
    StoryGraph: ({ entities, onSelect }) => (
      <ul aria-label="Story graph entities">
        {entities.map((e) => (
          <li key={e.name}>
            <button type="button" onClick={() => onSelect(e.name)}>
              {e.name}
            </button>
          </li>
        ))}
      </ul>
    ),
  };
});

const rect = { left: 100, top: 100, bottom: 120, right: 200, width: 100, height: 20, x: 100, y: 100, toJSON() {} };
Range.prototype.getBoundingClientRect ??= () => rect;
Range.prototype.getClientRects ??= () => /** @type {any} */ ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
document.elementFromPoint ??= () => null;
window.scrollBy = () => {};

const para = (blockId, text) => ({ type: 'paragraph', attrs: { blockId }, content: [{ type: 'text', text }] });
const glass = (fake) => fake.db.writer.manuscripts.find((m) => m.title === 'The Glass Meridian');
const storm = (fake) => fake.db.writer.nodes.find((n) => n.title === 'The Storm Bell');
const stormDoc = (fake) => fake.db.writer.docs.find((d) => d.nodeId === storm(fake).id);
const msUrl = (fake) => `/app/writer/manuscripts/${glass(fake).id}`;
const openTab = (name) => fireEvent.mouseDown(screen.getByRole('tab', { name: new RegExp(`^${name}`) }), { button: 0, ctrlKey: false });
const openMenu = (trigger) => fireEvent.keyDown(trigger, { key: 'Enter' });
const saveStatus = () => within(screen.getByRole('region', { name: 'Scene editor' })).getAllByRole('status')[0];

async function getEditor() {
  await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeTruthy());
  return /** @type {any} */ (document.querySelector('.ProseMirror')).editor;
}
function appendTo(editor, blockId, text) {
  const pos = findBlock(editor, blockId);
  const node = editor.state.doc.nodeAt(pos);
  act(() => {
    editor.chain().insertContentAt(pos + node.nodeSize - 1, text).run();
  });
}
const blockTextIn = (editor, blockId) => blocksOf(editor.getJSON()).find((b) => b.blockId === blockId)?.text;

async function openManuscript(opts = {}) {
  const fake = installFakeFetch(createFakeApi(opts));
  const router = renderApp(msUrl(fake));
  await screen.findByRole('heading', { level: 1, name: 'Chapter One — Salt on the Lens' });
  const editor = await getEditor();
  return { fake, router, editor };
}

beforeEach(() => setDraftStore(memoryDraftStore()));
afterEach(() => vi.useRealTimers());

describe('writer document helpers', () => {
  it('diffs words and keeps whitespace', () => {
    expect(wordDiff('the dark water', 'the cold dark water')).toEqual([
      { op: 'eq', text: 'the ' },
      { op: 'ins', text: 'cold ' },
      { op: 'eq', text: 'dark water' },
    ]);
    expect(wordDiff('a b', 'a b')).toEqual([{ op: 'eq', text: 'a b' }]);
    const big = Array.from({ length: 800 }, (_, i) => `w${i}`).join(' ');
    expect(wordDiff(big, `${big} x`).map((s) => s.op)).toEqual(['del', 'ins']);
  });

  it('aligns scene revisions by blockId', () => {
    const before = { type: 'doc', content: [para('a', 'One.'), para('b', 'Two.'), para('c', 'Three.')] };
    const after = { type: 'doc', content: [para('a', 'One!'), para('c', 'Three.'), para('d', 'Four.')] };
    expect(blockDiff(before, after).map((r) => [r.blockId, r.status])).toEqual([
      ['a', 'changed'],
      ['b', 'removed'],
      ['c', 'same'],
      ['d', 'added'],
    ]);
  });

  it('replaces one block like the API and counts prose words only', () => {
    const doc = { type: 'doc', content: [para('a', 'Mara’s well-worn coat.'), citationNode({ id: 'n1', title: 'Ledger', quote: 'Oil until 1887', source: { title: 'Ledger.pdf', anchor: { selectors: { page: 4 } } } })] };
    expect(docText(doc)).toBe('Mara’s well-worn coat.');
    expect(countWords(docText(doc))).toBe(3);
    expect(citationText({ title: 'T', quote: 'Q', source: { title: 'Ledger.pdf', anchor: { selectors: { page: 4 } } } })).toBe('“Q” — Ledger.pdf, p. 4');
    const next = replaceBlockText(doc, 'a', 'Line one\nline two', { aiAssisted: true });
    expect(next.content[0]).toEqual({ type: 'paragraph', attrs: { blockId: 'a', aiAssisted: true }, content: [{ type: 'text', text: 'Line one' }, { type: 'hardBreak' }, { type: 'text', text: 'line two' }] });
    expect(doc.content[0].content[0].text).toBe('Mara’s well-worn coat.');
    expect(replaceBlockText(doc, 'missing', 'x')).toBeNull();
  });

  it('keeps block ids unique when paragraphs are split or pasted', () => {
    const editor = new Editor({ extensions: [StarterKit, BlockAttrs, Citation], content: { type: 'doc', content: [para('a', 'Hello world')] } });
    editor.commands.setTextSelection(6);
    editor.commands.splitBlock();
    editor.commands.insertContentAt(editor.state.doc.content.size, para('a', 'Pasted copy'));
    const ids = blocksOf(editor.getJSON()).map((b) => b.blockId);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toBe('a');
    editor.destroy();
  });

  it('stores drafts in memory when IndexedDB is unavailable', async () => {
    const s = memoryDraftStore();
    await s.put('k', { content: { type: 'doc' }, baseRevision: 2, savedAt: 'now' });
    expect(await s.get('k')).toEqual({ content: { type: 'doc' }, baseRevision: 2, savedAt: 'now' });
    await s.remove('k');
    expect(await s.get('k')).toBeUndefined();
  });

  it('lays out the story graph without retired links', () => {
    const { nodes, edges } = layoutStory(
      [
        { name: 'Mara', kind: 'CHARACTER', proposed: false },
        { name: 'Tomas', kind: 'CHARACTER', proposed: true },
      ],
      [
        { id: 'l1', source: 'Mara', target: 'Tomas', label: 'sibling', status: 'CANON', weight: 1 },
        { id: 'l2', source: 'Mara', target: 'Tomas', label: 'old', status: 'RETIRED', weight: 1 },
        { id: 'l3', source: 'Mara', target: 'Nobody', label: 'x', status: 'CANON', weight: 1 },
      ],
      'Mara',
    );
    expect(nodes.map((n) => n.className)).toEqual(['sg-node selected', 'sg-node proposed']);
    expect(edges.map((e) => e.id)).toEqual(['l1']);
  });
});

describe('Folio Writer', () => {
  it('lists manuscripts and creates one with a starter outline', async () => {
    const fake = installFakeFetch(createFakeApi());
    const router = renderApp('/app/writer');
    expect(await screen.findByRole('link', { name: /The Glass Meridian/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New manuscript' }));
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Night Crossing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/app\/writer\/manuscripts\//));
    expect(await screen.findByRole('heading', { level: 1, name: 'Chapter 1' })).toBeInTheDocument();
    expect(fake.db.projects.some((p) => p.name === 'Night Crossing' && p.kind === 'WRITER')).toBe(true);
  });

  it('shows the outline, word counts and the saved revision', async () => {
    const { fake } = await openManuscript();
    const outline = screen.getByRole('navigation', { name: 'Manuscript structure' });
    expect(within(outline).getByRole('button', { name: /^The Storm Bell/ })).toHaveAttribute('aria-current', 'true');
    expect(within(outline).getByRole('button', { name: /^A Letter, Unopened/ })).toBeInTheDocument();
    expect(saveStatus()).toHaveTextContent('Saved · r0');
    expect(screen.getByText(new RegExp(`Scene ${stormDoc(fake).wordCount} words`))).toBeInTheDocument();
    expect(screen.getByText(/Today 0 \/ 500 words/)).toBeInTheDocument();
  });

  it('autosaves edits with the known revision and updates counts', async () => {
    const { fake, editor } = await openManuscript();
    const before = stormDoc(fake).wordCount;
    appendTo(editor, 'blk-storm-1', ' Rain came sideways.');
    expect(saveStatus()).toHaveTextContent('Unsaved changes');
    await waitFor(() => expect(saveStatus()).toHaveTextContent('Saved · r1'));
    expect(stormDoc(fake).text).toContain('Rain came sideways.');
    expect(stormDoc(fake).wordCount).toBe(before + 3);
    expect(fake.db.log.filter((l) => l.startsWith('PATCH') && l.endsWith('/doc'))).toHaveLength(1);
    expect(screen.getByText(/Today 3 \/ 500 words/)).toBeInTheDocument();
  });

  it('offers a merge when the scene was saved elsewhere', async () => {
    const { fake, editor } = await openManuscript();
    const d = stormDoc(fake);
    d.revision = 4;
    d.content = { type: 'doc', content: [...d.content.content.slice(0, 2), para('blk-storm-3', 'Below, Tomas waited in silence.')] };
    appendTo(editor, 'blk-storm-1', ' Mine.');
    const dialog = await screen.findByRole('dialog', { name: 'This scene changed somewhere else' });
    expect(within(dialog).getByText(/Revision r4 was saved/)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/Mine\./).length).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep my version' }));
    await waitFor(() => expect(saveStatus()).toHaveTextContent('Saved · r5'));
    expect(stormDoc(fake).text).toContain('Mine.');
  });

  it('can drop local edits for the version saved elsewhere', async () => {
    const { fake, editor } = await openManuscript();
    const d = stormDoc(fake);
    d.revision = 2;
    d.content = { type: 'doc', content: [para('blk-storm-1', 'Saved on another device.')] };
    appendTo(editor, 'blk-storm-1', ' Mine.');
    const dialog = await screen.findByRole('dialog', { name: 'This scene changed somewhere else' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use saved version (r2)' }));
    await waitFor(() => expect(blockTextIn(editor, 'blk-storm-1')).toBe('Saved on another device.'));
    expect(saveStatus()).toHaveTextContent('Saved · r2');
  });

  it('recovers an unsaved local draft', async () => {
    const fake = installFakeFetch(createFakeApi());
    const store = memoryDraftStore();
    setDraftStore(store);
    const d = stormDoc(fake);
    await store.put(draftKey(fake.db.workspaces[0].id, storm(fake).id), {
      content: { type: 'doc', content: [para('blk-storm-1', 'Recovered from this device.')] },
      baseRevision: 0,
      savedAt: new Date().toISOString(),
    });
    renderApp(msUrl(fake));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore draft' }));
    const editor = await getEditor();
    expect(blockTextIn(editor, 'blk-storm-1')).toBe('Recovered from this device.');
    await waitFor(() => expect(d.text).toBe('Recovered from this device.'));
    expect(await store.get(draftKey(fake.db.workspaces[0].id, storm(fake).id))).toBeUndefined();
  });

  it('turns a Lens rewrite into a pending suggestion, then accepts and undoes it', async () => {
    const { fake, editor } = await openManuscript();
    fireEvent.click(screen.getByRole('button', { name: /Open Folio Lens/ }));
    const lens = await screen.findByRole('dialog', { name: 'Folio Lens' });
    expect(within(lens).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Rewrite paragraph', 'Tighten', 'Expand', 'Change tone…', 'Look up canon']);
    fireEvent.click(within(lens).getByRole('menuitem', { name: 'Tighten' }));
    const card = await screen.findByRole('listitem', { name: 'Suggestion for ¶1' });
    expect(within(card).getByText('Pending review')).toBeInTheDocument();
    expect(within(card).getByText('DEMO')).toBeInTheDocument();
    expect(card.querySelector('.diff ins')).toHaveTextContent('and the night held its breath.');
    const s = fake.db.writer.suggestions[0];
    expect(s).toMatchObject({ mode: 'shorten', blockId: 'blk-storm-1', state: 'PENDING', baseRevision: 0 });
    expect(document.querySelector('.w-pending')).toHaveAttribute('data-block-id', 'blk-storm-1');

    fireEvent.click(within(card).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(blockTextIn(editor, 'blk-storm-1')).toBe(s.variants[0].text));
    expect(s.state).toBe('ACCEPTED');
    expect(stormDoc(fake).content.content[0].attrs.aiAssisted).toBe(true);
    expect(fake.db.writer.revisions.at(-1)).toMatchObject({ revision: 1, origin: 'POST_AI' });
    expect(document.querySelector('[data-block-id="blk-storm-1"]')).toHaveAttribute('data-ai', 'true');

    fireEvent.click(await within(document.querySelector('.toaster')).findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(blockTextIn(editor, 'blk-storm-1')).toBe(s.baseText));
    expect(s.state).toBe('PENDING');
    expect(fake.db.writer.revisions.at(-1)).toMatchObject({ revision: 2, origin: 'UNDO' });
  });

  it('marks a suggestion stale when its paragraph is edited, and supersedes it on regenerate', async () => {
    const { fake, editor } = await openManuscript();
    openTab('Suggestions');
    fireEvent.click(screen.getByRole('button', { name: 'Revise whole scene' }));
    await waitFor(() => expect(screen.getAllByRole('listitem', { name: /Suggestion for/ })).toHaveLength(3));
    const batch = new Set(fake.db.writer.suggestions.map((s) => s.batchId));
    expect(batch.size).toBe(1);
    expect(fake.db.ai.runs.filter((r) => r.graph === 'writer_revision' && r.tier === 'T0')).toHaveLength(3);

    appendTo(editor, 'blk-storm-2', ' Salt stung.');
    const card = screen.getByRole('listitem', { name: 'Suggestion for ¶2' });
    expect(within(card).getByText(/The paragraph changed after this suggestion/)).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
    await waitFor(() => expect(fake.db.writer.suggestions.find((s) => s.blockId === 'blk-storm-2').state).toBe('STALE'));

    fireEvent.click(within(card).getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => expect(fake.db.writer.suggestions.filter((s) => s.blockId === 'blk-storm-2').map((s) => s.state)).toEqual(['SUPERSEDED', 'PENDING']));

    const third = screen.getByRole('listitem', { name: 'Suggestion for ¶3' });
    fireEvent.click(within(third).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Suggestion for ¶3' })).not.toBeInTheDocument());
    fireEvent.click(screen.getByText(/Earlier suggestions/));
    fireEvent.click(screen.getByRole('button', { name: 'Undo reject' }));
    expect(await screen.findByRole('listitem', { name: 'Suggestion for ¶3' })).toBeInTheDocument();
  });

  it('checks the scene against canon and resolves the issue', async () => {
    const { fake } = await openManuscript();
    openTab('Context');
    expect(screen.getByText(/Mara: eye color is green\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check this scene' }));
    const issue = await screen.findByRole('listitem', { name: 'Continuity issue: Mara, eye color' });
    expect(issue).toHaveTextContent('Canon says green; this scene says blue.');
    expect(within(issue).getByText(/her blue eyes narrowing/)).toBeInTheDocument();
    expect(document.querySelector('.w-flagged')).toHaveAttribute('data-block-id', 'blk-storm-2');
    expect(screen.getByRole('tab', { name: /Context/ })).toHaveTextContent('1');
    fireEvent.click(within(issue).getByRole('button', { name: 'Mark resolved' }));
    await waitFor(() => expect(fake.db.writer.issues[0].state).toBe('RESOLVED'));
    expect(await screen.findByText('No open continuity issues in this scene.')).toBeInTheDocument();
  });

  it('looks up canon for a passage from the Lens', async () => {
    const { editor } = await openManuscript();
    act(() => {
      editor.commands.setTextSelection(findBlock(editor, 'blk-storm-2') + 2);
    });
    fireEvent.click(screen.getByRole('button', { name: /Open Folio Lens/ }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Folio Lens' })).getByRole('menuitem', { name: 'Look up canon' }));
    expect(await screen.findByText(/Mara: eye color is green\./)).toBeInTheDocument();
  });

  it('adds an excerpt from Knowledge as a research note and inserts it as a footnote', async () => {
    const fake = installFakeFetch(createFakeApi());
    const wid = fake.db.workspaces[0].id;
    const source = fake.db.sources.find((s) => s.title === 'Market Outlook 2026.pdf');
    fake.handle('POST', `/api/workspaces/${wid}/excerpts`, { sourceId: source.id, quote: 'annual rate of 14.2%', anchor: { selectors: { page: 1 } } }, { 'x-csrf-token': 'test-csrf-token' });
    renderApp(msUrl(fake));
    const editor = await getEditor();
    openTab('Research');
    fireEvent.click(await screen.findByRole('button', { name: 'Add to notes' }));
    const notes = await screen.findByRole('list', { name: 'Research notes' });
    expect(within(notes).getByText('“annual rate of 14.2%”')).toBeInTheDocument();
    expect(within(notes).getByRole('link', { name: /Source: Market Outlook 2026.pdf, p. 1/ })).toBeInTheDocument();
    fireEvent.click(within(notes).getByRole('button', { name: 'Insert as footnote' }));
    await waitFor(() => expect(document.querySelector('aside[data-type="citation"]')).toHaveTextContent('“annual rate of 14.2%” — Market Outlook 2026.pdf, p. 1'));
    expect(blocksOf(editor.getJSON())[1].type).toBe('citation');
    await waitFor(() => expect(blocksOf(stormDoc(fake).content).some((b) => b.type === 'citation')).toBe(true));
  });

  it('compares a revision with the current text and restores it', async () => {
    const { fake, editor } = await openManuscript();
    appendTo(editor, 'blk-storm-1', ' Extra line.');
    await waitFor(() => expect(saveStatus()).toHaveTextContent('Saved · r1'));
    openTab('History');
    const list = await screen.findByRole('list', { name: 'Revisions' });
    fireEvent.click(within(list).getByRole('button', { name: /r0/ }));
    expect(await screen.findByRole('heading', { name: 'r0 → current text' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Restore r0' })).toBeInTheDocument());    expect(document.querySelector('.w-docdiff')).toHaveTextContent('Extra line.');
    fireEvent.click(screen.getByRole('button', { name: 'Restore r0' }));
    await waitFor(() => expect(blockTextIn(editor, 'blk-storm-1')).not.toContain('Extra line.'));
    expect(fake.db.writer.revisions.at(-1)).toMatchObject({ revision: 2, origin: 'RESTORE', note: 'Restored r0' });
    expect(saveStatus()).toHaveTextContent('Saved · r2');
  });

  it('is read-only for viewers', async () => {
    const fake = installFakeFetch(createFakeApi({ role: 'VIEWER' }));
    fake.db.memberships[0].role = 'VIEWER';
    renderApp(msUrl(fake));
    const editor = await getEditor();
    expect(editor.isEditable).toBe(false);
    expect(saveStatus()).toHaveTextContent('Read only');
    expect(screen.queryByRole('button', { name: 'Check continuity' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revise whole scene' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Open Folio Lens/ }));
    expect(within(await screen.findByRole('dialog', { name: 'Folio Lens' })).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Look up canon']);
  });

  it('switches scenes from the outline and keeps the URL in step', async () => {
    const { router } = await openManuscript();
    fireEvent.click(screen.getByRole('button', { name: /^A Letter, Unopened/ }));
    await waitFor(() => expect(router.state.location.search).toMatch(/scene=/));
    await waitFor(() => expect(document.querySelector('.ProseMirror')).toHaveTextContent('The letter from Tomas lay on the chart table'));
  });

  it('adds a scene to a chapter from the outline menu', async () => {
    const { fake } = await openManuscript();
    openMenu(screen.getByRole('button', { name: 'Actions for Chapter One — Salt on the Lens' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add scene' }));
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Low Tide' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Low Tide/ })).toHaveAttribute('aria-current', 'true'));
    expect(fake.db.writer.nodes.some((n) => n.title === 'Low Tide' && n.kind === 'SCENE')).toBe(true);
  });
});

describe('Narrative DNA and continuity pages', () => {
  it('proposes facts from the manuscript; only approval makes canon', async () => {
    const fake = installFakeFetch(createFakeApi());
    renderApp(`${msUrl(fake)}/dna`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Story canon & continuity' })).toBeInTheDocument();
    expect(screen.getByText('No proposals waiting. New extractions appear here first.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Extract from manuscript' }));
    const proposals = await screen.findByRole('list', { name: 'Proposed facts' });
    expect(within(proposals).getByText('Tomas is a character in the story.')).toBeInTheDocument();
    expect(fake.db.writer.facts.filter((f) => f.status === 'PROPOSED').every((f) => f.origin === 'AI_EXTRACTED')).toBe(true);
    expect(fake.db.writer.facts.find((f) => f.subject === 'Mara' && f.predicate).status).toBe('CANON');

    fireEvent.click(within(proposals).getByRole('button', { name: 'Approve: Tomas is a character in the story.' }));
    await waitFor(() => expect(fake.db.writer.facts.find((f) => f.subject === 'Tomas').status).toBe('CANON'));
    const ledger = screen.getByRole('table');
    expect(await within(ledger).findByText('Tomas is a character in the story.')).toBeInTheDocument();
    expect(within(ledger).getAllByRole('link', { name: /Tomas/ })[0].getAttribute('href')).toMatch(/\?scene=.+&block=blk-storm-3$/);

    const rejectBtn = within(screen.getByRole('list', { name: 'Proposed facts' })).getByRole('button', { name: /^Reject: Mara is a character/ });
    fireEvent.click(rejectBtn);
    await waitFor(() => expect(fake.db.writer.facts.find((f) => f.subject === 'Mara' && !f.predicate)).toMatchObject({ status: 'RETIRED', note: 'Rejected by author' }));
  });

  it('adds an author canon fact', async () => {
    const fake = installFakeFetch(createFakeApi());
    renderApp(`${msUrl(fake)}/dna`);
    const form = await screen.findByRole('form', { name: 'Add a canon fact' });
    fireEvent.change(within(form).getByLabelText('Subject'), { target: { value: 'Tomas' } });
    fireEvent.change(within(form).getByLabelText('Fact'), { target: { value: 'years away' } });
    fireEvent.change(within(form).getByLabelText('Value'), { target: { value: 'eleven' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add to canon' }));
    expect(await within(screen.getByRole('table')).findByText('Tomas: years away is eleven.')).toBeInTheDocument();
    expect(fake.db.writer.facts.at(-1)).toMatchObject({ status: 'CANON', origin: 'AUTHOR' });
  });

  it('lists issues across scenes, dismisses and reopens them, and jumps to the passage', async () => {
    const fake = installFakeFetch(createFakeApi());
    const router = renderApp(`${msUrl(fake)}/continuity`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Continuity issues' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check all scenes' }));
    const issue = await screen.findByRole('listitem', { name: 'Continuity issue: Mara, eye color' });
    expect(issue).toHaveTextContent('“The Storm Bell” says blue');
    expect(fake.db.ai.runs.filter((r) => r.graph === 'continuity_check')).toHaveLength(2);
    fireEvent.click(within(issue).getByRole('button', { name: 'Dismiss' }));
    expect(await screen.findByText('No open continuity issues.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismissed (1)' }));
    fireEvent.click(within(await screen.findByRole('listitem', { name: /Continuity issue/ })).getByRole('button', { name: 'Show in text' }));
    await waitFor(() => expect(router.state.location.search).toBe(`?scene=${storm(fake).id}&block=blk-storm-2`));
  });

  it('renders the print view with numbered footnotes', async () => {
    const fake = installFakeFetch(createFakeApi());
    const d = stormDoc(fake);
    d.content.content.splice(1, 0, { type: 'citation', attrs: { blockId: 'cite-1' }, content: [{ type: 'text', text: '“Oil until 1887” — Ledger.pdf' }] });
    renderApp(`${msUrl(fake)}/print`);
    expect(await screen.findByRole('heading', { level: 1, name: 'The Glass Meridian' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Chapter One — Salt on the Lens' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Footnote 1' }).closest('p')).toHaveTextContent('The storm bell rang twice');
    expect(within(screen.getByRole('region', { name: 'Footnotes' })).getByText(/Oil until 1887/)).toBeInTheDocument();
  });
});
