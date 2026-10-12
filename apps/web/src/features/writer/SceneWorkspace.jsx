import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import * as Tabs from '@radix-ui/react-tabs';
import { useQueryClient } from '@tanstack/react-query';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { api } from '@/api/client.js';
import { Icon } from '@/shared/icons.jsx';
import { FolioLens, LENS_ACTIONS } from '@/shared/overlays/FolioLens.jsx';
import { Badge, Button, Callout, DropdownMenu, IconButton, Progress, Segmented, Skeleton, toast } from '@/shared/ui/index.js';
import { blocksOf, citationNode, countWords, docText, replaceBlockText, squash } from './doc.js';
import { draftKey, draftStore } from './drafts.js';
import { BlockAttrs, Citation, ReviewMarks, blockAtSelection, findBlock, setReviewMarks } from './editor.js';
import { MergeDialog } from './MergeDialog.jsx';
import { useContinuity, useDna, useExcerpts, useResearchNotes, useRevisions, useRunsWatch, useSceneDoc, useSuggestions, writerApi, writerKeys } from './queries.js';
import { ContextPanel, HistoryPanel, ResearchPanel, SuggestionsPanel, TONES } from './ScenePanels.jsx';
import { useSceneSync } from './useSceneSync.js';

const PREFS_KEY = 'fv-writer-prefs';
const FONT_SIZES = [15, 16, 17, 18, 19, 20, 22, 24];
const LENS_MODE = { rewrite: 'rewrite', tighten: 'shorten', expand: 'expand' };
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const sameBlocks = (a, b) => JSON.stringify(blocksOf(a).map(({ blockId, type, text }) => [blockId, type, text])) === JSON.stringify(blocksOf(b).map(({ blockId, type, text }) => [blockId, type, text]));

function usePrefs() {
  const [prefs, setPrefs] = useState(() => {
    try {
      return { size: 19, font: 'serif', ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
    } catch {
      return { size: 19, font: 'serif' };
    }
  });
  const update = (patch) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      return next;
    });
  return [prefs, update];
}

function download(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Loads one scene document, then mounts the editing session for it. */
export function SceneWorkspace(props) {
  const doc = useSceneDoc(props.wid, props.manuscript.id, props.sceneId);
  if (doc.isPending) {
    return (
      <section className="pane" aria-busy="true">
        <div className="canvas">
          <Skeleton height={28} width="50%" />
          <Skeleton height={300} />
        </div>
      </section>
    );
  }
  if (doc.error) {
    return (
      <section className="pane">
        <div className="page">
          <Callout tone="bad" role="alert">
            The scene could not be loaded: {doc.error.message}
          </Callout>
        </div>
      </section>
    );
  }
  return <SceneSession {...props} initial={doc.data} />;
}

function SceneSession({ wid, manuscript, sceneId, editable, focus, setFocus, jumpTo, initial }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const mid = manuscript.id;
  const scene = manuscript.nodes.find((n) => n.id === sceneId);
  const chapter = manuscript.nodes.find((n) => n.id === scene?.parentId);
  const part = chapter ? manuscript.nodes.find((n) => n.id === chapter.parentId) : null;
  const dnaHref = `/app/writer/manuscripts/${mid}/dna`;

  const editorRef = useRef(/** @type {import('@tiptap/react').Editor | null} */ (null));
  const getContent = useCallback(() => editorRef.current?.getJSON() ?? initial.content, [initial.content]);
  const sync = useSceneSync({ wid, manuscriptId: mid, nodeId: sceneId, initial, getContent, enabled: editable });
  const onChangeRef = useRef(sync.onChange);
  onChangeRef.current = sync.onChange;

  const [words, setWords] = useState(() => countWords(docText(initial.content)));
  const [, setVersion] = useState(0);
  const [prefs, setPrefs] = usePrefs();
  const [tab, setTab] = useState('suggestions');
  const [lens, setLens] = useState(/** @type {any} */ (null));
  const [recover, setRecover] = useState(/** @type {any} */ (null));
  const [flash, setFlash] = useState(/** @type {string | null} */ (null));
  const [watch, setWatch] = useState(/** @type {string[]} */ ([]));
  const lensButton = useRef(/** @type {HTMLButtonElement | null} */ (null));

  const refreshCounts = useCallback(() => {
    const e = editorRef.current;
    if (!e) return;
    setWords(countWords(docText(e.getJSON())));
    setVersion((v) => v + 1);
  }, []);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [2, 3] }, codeBlock: false, code: false, horizontalRule: false }),
        Placeholder.configure({ placeholder: editable ? 'Begin the scene…' : '' }),
        BlockAttrs,
        ReviewMarks,
        Citation,
      ],
      content: initial.content,
      editable,
      editorProps: { attributes: { 'aria-label': `Scene text: ${scene?.title ?? 'scene'}`, spellcheck: 'true', class: 'w-prose' } },
      onUpdate: () => {
        refreshCounts();
        onChangeRef.current();
      },
    },
    [],
  );
  editorRef.current = editor;

  /** Replaces the document without creating an undo step or an autosave (the server already has it). */
  const replaceContent = useCallback(
    (content) => {
      editor?.chain().setMeta('addToHistory', false).setContent(content, { emitUpdate: false }).run();
      refreshCounts();
    },
    [editor, refreshCounts],
  );

  const suggestions = useSuggestions(wid, mid, sceneId);
  const continuity = useContinuity(wid, mid);
  const dna = useDna(wid, mid);
  const notes = useResearchNotes(wid, mid);
  const excerpts = useExcerpts(wid, editable && tab === 'research');
  const revisions = useRevisions(wid, mid, sceneId, tab === 'history');
  const watched = useRunsWatch(wid, watch);

  const sceneIssues = useMemo(() => (continuity.data ?? []).filter((i) => i.nodeId === sceneId && i.state === 'OPEN'), [continuity.data, sceneId]);
  const issueBlock = (i) => (i.anchors ?? []).find((a) => a.role === 'scene')?.blockId ?? i.blockId;
  const pendingIds = (suggestions.data ?? []).filter((s) => s.state === 'PENDING' && s.variants?.length).map((s) => s.blockId);
  const flaggedIds = sceneIssues.map(issueBlock).filter(Boolean);
  const marksKey = `${pendingIds.join(',')}|${flaggedIds.join(',')}|${flash ?? ''}`;

  useEffect(() => {
    if (editor) setReviewMarks(editor, { pending: pendingIds, flagged: flaggedIds, flash });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- marksKey captures the id lists
  }, [editor, marksKey]);

  useEffect(() => {
    if (!editable) return undefined;
    let live = true;
    draftStore.get(draftKey(wid, sceneId)).then((d) => {
      if (live && d?.content && !sameBlocks(d.content, initial.content)) setRecover(d);
    });
    return () => {
      live = false;
    };
  }, [wid, sceneId, editable, initial.content]);

  useEffect(() => {
    if (!watch.length || watched.pending) return;
    const failed = watched.runs.filter((r) => !['SUCCEEDED', 'PARTIAL'].includes(r.status));
    qc.invalidateQueries({ queryKey: writerKeys.continuity(wid, mid) });
    toast(failed.length ? `Continuity check ended: ${failed[0].status.toLowerCase()}.` : 'Continuity check finished.', failed.length ? 'warn' : 'ok');
    setWatch([]);
  }, [watch, watched.pending, watched.runs, qc, wid, mid]);

  const jumpToBlock = useCallback(
    (blockId) => {
      if (!editor || !blockId) return;
      const pos = findBlock(editor, blockId);
      if (pos < 0) return toast('That passage is no longer in this scene.', 'warn');
      setFocus(false);
      editor.commands.setTextSelection(pos + 1);
      const dom = editor.view.nodeDOM(pos);
      if (dom instanceof HTMLElement) dom.scrollIntoView?.({ block: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth' });
      setFlash(blockId);
      window.setTimeout(() => setFlash((f) => (f === blockId ? null : f)), 1200);
    },
    [editor, setFocus],
  );

  useEffect(() => {
    if (editor && jumpTo) jumpToBlock(jumpTo);
  }, [editor, jumpTo, jumpToBlock]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        sync.flush();
      } else if (e.key === 'Escape' && focus && !lens) setFocus(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sync, focus, lens, setFocus]);

  // ── actions ──
  const invalidateSuggestions = () => qc.invalidateQueries({ queryKey: writerKeys.suggestions(wid, mid, sceneId) });

  async function requestSuggestions(body) {
    setLens(null);
    setTab('suggestions');
    setFocus(false);
    try {
      await sync.flush();
      const res = await writerApi.requestSuggestions(wid, mid, sceneId, body);
      if (res.budgetRejected) toast('The budget limit was reached: some paragraphs were not sent.', 'warn');
    } catch (err) {
      toast(err.message, 'bad');
    }
    invalidateSuggestions();
  }

  async function accept(s, vi) {
    const variant = s.variants?.[vi];
    if (!variant || !editor) return;
    await sync.flush();
    const json = editor.getJSON();
    const cur = blocksOf(json).find((b) => b.blockId === s.blockId);
    if (!cur || squash(cur.text) !== squash(s.baseText)) {
      toast('This paragraph changed after the suggestion was made. Regenerate it to apply safely.', 'warn');
      return;
    }
    const next = replaceBlockText(json, s.blockId, variant.text, { aiAssisted: true });
    try {
      const res = await sync.commit(next, { action: 'accept', suggestionId: s.id, variant: vi });
      replaceContent(next);
      toast(`Suggestion accepted · saved as r${res.revision}`, 'ok', { label: 'Undo', onClick: () => undo({ ...s, state: 'ACCEPTED', chosen: vi }) });
    } catch (err) {
      if (err.code !== 'REVISION_CONFLICT') toast(err.message, err.code === 'SUGGESTION_STALE' ? 'warn' : 'bad');
    }
    invalidateSuggestions();
  }

  async function undo(s) {
    if (!editor) return;
    const accepted = s.variants?.[s.chosen ?? 0]?.text ?? '';
    await sync.flush();
    const json = editor.getJSON();
    const cur = blocksOf(json).find((b) => b.blockId === s.blockId);
    if (!cur || squash(cur.text) !== squash(accepted)) {
      toast('The paragraph was edited after accepting. Restore an earlier revision from History instead.', 'warn');
      return;
    }
    const next = replaceBlockText(json, s.blockId, s.baseText, { aiAssisted: false });
    try {
      await sync.commit(next, { action: 'undo', suggestionId: s.id });
      replaceContent(next);
      toast('Suggestion undone. It is pending again.', 'ok');
    } catch (err) {
      if (err.code !== 'REVISION_CONFLICT') toast(err.message, 'bad');
    }
    invalidateSuggestions();
  }

  async function setSuggestionState(s, state) {
    try {
      await writerApi.updateSuggestion(wid, s.id, state);
    } catch (err) {
      toast(err.message, 'bad');
    }
    invalidateSuggestions();
  }

  async function restore(rev) {
    try {
      await sync.flush();
      const res = await writerApi.restore(wid, mid, sceneId, rev.revision, sync.revision.current);
      replaceContent(rev.content);
      sync.adopt(res);
      invalidateSuggestions();
      toast(`Restored r${rev.revision} as r${res.revision}.`, 'ok');
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  async function checkScene() {
    setTab('context');
    try {
      await sync.flush();
      const res = await writerApi.checkContinuity(wid, mid, { nodeIds: [sceneId] });
      setWatch(res.runs.map((r) => r.runId));
    } catch (err) {
      toast(err.message, err.code === 'NO_CANON' || err.code === 'NO_TEXT' ? 'warn' : 'bad');
    }
  }

  async function setIssue(i, state) {
    try {
      await writerApi.updateIssue(wid, mid, i.id, state);
    } catch (err) {
      toast(err.message, 'bad');
    }
    qc.invalidateQueries({ queryKey: writerKeys.continuity(wid, mid) });
  }

  function insertCitation(note) {
    if (!editor) return;
    const block = blockAtSelection(editor);
    const at = block ? block.pos + (editor.state.doc.nodeAt(block.pos)?.nodeSize ?? 0) : editor.state.doc.content.size;
    editor.chain().focus().insertContentAt(at, citationNode(note)).run();
    toast('Footnote inserted. It exports as a numbered footnote.', 'ok');
  }

  // ── Folio Lens ──
  function openLens() {
    if (!editor) return;
    const block = blockAtSelection(editor);
    if (!block) return;
    const { from, to, empty } = editor.state.selection;
    const text = empty ? block.text : editor.state.doc.textBetween(from, to, ' ');
    if (!text.trim()) return;
    let rect;
    try {
      const a = editor.view.coordsAtPos(from);
      const b = editor.view.coordsAtPos(to);
      rect = { left: a.left, top: a.top, bottom: b.bottom, width: Math.max(1, b.right - a.left) };
    } catch {
      const r = lensButton.current?.getBoundingClientRect();
      rect = r ? { left: r.left, top: r.top, bottom: r.bottom, width: r.width } : { left: 0, top: 0, bottom: 0, width: 0 };
    }
    setLens({ text, block, partial: !empty && squash(text) !== squash(block.text), rect, actions: null, result: null });
  }

  async function onLensAction(id) {
    const { block, partial, text } = lens;
    const instruction = partial ? `Focus on this part: “${clip(text, 200)}”.` : undefined;
    if (id === 'tone') return setLens((l) => ({ ...l, actions: TONES.map((t) => [`tone:${t}`, `Tone · ${t}`]) }));
    if (id.startsWith('tone:')) return requestSuggestions({ mode: 'tone', tone: id.slice(5), blockIds: [block.blockId], instruction });
    if (LENS_MODE[id]) return requestSuggestions({ mode: LENS_MODE[id], blockIds: [block.blockId], instruction });
    if (id === 'continuity') {
      setLens((l) => l && { ...l, result: { phase: 'loading' } });
      try {
        const data = await qc.fetchQuery({ queryKey: writerKeys.dna(wid, mid), queryFn: () => api(`${writerApi.base(wid, mid)}/dna`) });
        const low = text.toLowerCase();
        const hits = data.facts.filter((f) => f.status === 'CANON' && low.includes(f.subject.toLowerCase()));
        setLens(
          (l) =>
            l && {
              ...l,
              result: {
                phase: 'done',
                message: 'No approved canon facts mention this passage.',
                items: hits.map((f) => ({ id: f.id, title: f.subject, snippet: f.statement, onOpen: () => navigate(dnaHref) })),
              },
            },
        );
      } catch (err) {
        setLens((l) => l && { ...l, result: { phase: 'error', message: err.message } });
      }
    }
  }

  const lensActions = lens?.actions ?? LENS_ACTIONS.W.filter(([id]) => editable || id === 'continuity');
  const stats = manuscript.stats ?? { words: 0, todayWords: 0, dailyGoal: 0 };
  const blockList = blocksOf(getContent());
  const blockIndex = new Map(blockList.filter((b) => b.type !== 'citation').map((b, i) => [b.blockId, i + 1]));
  const blockText = (id) => blockList.find((b) => b.blockId === id)?.text ?? null;
  const blockLabel = (id) => (blockIndex.has(id) ? `¶${blockIndex.get(id)}` : 'Removed paragraph');
  const openSuggestions = (suggestions.data ?? []).filter((s) => s.state === 'PENDING').length;

  const STATUS = {
    saved: `Saved · r${sync.savedRevision}`,
    dirty: 'Unsaved changes',
    saving: 'Saving…',
    offline: 'Offline · changes kept on this device, retrying',
    conflict: 'Conflict · choose a version',
    error: `Not saved: ${sync.error}`,
  };

  return (
    <>
      <section className="pane w-main" aria-label="Scene editor">
        <div className="bar-top">
          <span className="eyebrow">
            {chapter?.title ?? 'Chapter'} · {scene?.title}
          </span>
          <span className="subtle" role="status" style={{ fontSize: 12 }}>
            {editable ? STATUS[sync.status] : 'Read only'}
          </span>
          <span className="grow" />
          <IconButton label="Decrease text size" onClick={() => setPrefs({ size: FONT_SIZES[Math.max(0, FONT_SIZES.indexOf(prefs.size) - 1)] ?? 19 })}>
            A−
          </IconButton>
          <span className="mono" aria-label={`Text size ${prefs.size} pixels`}>
            {prefs.size}px
          </span>
          <IconButton label="Increase text size" onClick={() => setPrefs({ size: FONT_SIZES[Math.min(FONT_SIZES.length - 1, FONT_SIZES.indexOf(prefs.size) + 1)] ?? 19 })}>
            A+
          </IconButton>
          <Segmented
            label="Typeface"
            value={prefs.font}
            onChange={(font) => setPrefs({ font })}
            options={[
              { value: 'serif', label: 'Serif' },
              { value: 'sans', label: 'Sans' },
            ]}
          />
          <Button ref={lensButton} size="sm" variant="ai" onClick={openLens} aria-label="Open Folio Lens for the selection or current paragraph">
            <Icon name="lens" size={14} />
            Lens
          </Button>
          {editable && (
            <Button size="sm" onClick={checkScene} disabled={watched.pending}>
              Check continuity
            </Button>
          )}
          <Link className="btn sm" to={dnaHref}>
            Narrative DNA
          </Link>
          <DropdownMenu
            trigger={
              <Button size="sm">
                <Icon name="download" size={14} />
                Export
              </Button>
            }
            items={[
              { label: 'Markdown (.md)', onSelect: () => sync.flush().then(() => download(`/api${writerApi.base(wid, mid)}/export?format=md`)) },
              { label: 'Word (.docx)', onSelect: () => sync.flush().then(() => download(`/api${writerApi.base(wid, mid)}/export?format=docx`)) },
              { label: 'Print or save as PDF', onSelect: () => sync.flush().then(() => navigate(`/app/writer/manuscripts/${mid}/print`)) },
            ]}
          />
          <Button size="sm" aria-pressed={focus} onClick={() => setFocus(!focus)}>
            <Icon name="focus" size={14} />
            {focus ? 'Exit focus' : 'Focus'}
          </Button>
        </div>
        <div className="canvas grow">
          <div className="wprog">
            {stats.dailyGoal > 0 ? (
              <>
                <span>
                  Today {stats.todayWords.toLocaleString()} / {stats.dailyGoal.toLocaleString()} words
                </span>
                <div className="grow" style={{ maxWidth: 200 }}>
                  <Progress value={(stats.todayWords / stats.dailyGoal) * 100} label="Daily goal progress" />
                </div>
              </>
            ) : (
              <span>Today {stats.todayWords.toLocaleString()} words</span>
            )}
            <span>
              Scene {words.toLocaleString()} words · manuscript {stats.words.toLocaleString()}
            </span>
          </div>
          {recover && (
            <Callout tone="warn" className="w-recover">
              <p>
                Unsaved changes to this scene from {new Date(recover.savedAt).toLocaleString()} were found on this device.
                {recover.baseRevision < initial.revision ? ' The scene was saved elsewhere since; restoring replaces that text (it stays in History).' : ''}
              </p>
              <div className="row" style={{ marginTop: 8 }}>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    editor?.commands.setContent(recover.content, { emitUpdate: true });
                    setRecover(null);
                  }}
                >
                  Restore draft
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    draftStore.remove(draftKey(wid, sceneId));
                    setRecover(null);
                  }}
                >
                  Discard
                </Button>
              </div>
            </Callout>
          )}
          <article
            className={`manuscript ${prefs.font}`}
            style={{ '--w-fs': `${prefs.size}px` }}
            aria-label={`Manuscript editor, ${scene?.title ?? 'scene'}`}
            onMouseUp={() => window.setTimeout(() => editor && !editor.state.selection.empty && openLens(), 0)}
            onKeyUp={(e) => {
              if (e.shiftKey && editor && !editor.state.selection.empty) openLens();
            }}
          >
            {part && (
              <p className="eyebrow" style={{ fontFamily: 'var(--fv-font-sans)' }}>
                {part.title}
              </p>
            )}
            <h1>{chapter?.title}</h1>
            <p className="subtle" style={{ font: '13px var(--fv-font-sans)' }}>
              {scene?.title}
              {scene?.pov ? ` · POV ${scene.pov}` : ''}
              {editable ? ' · select text, then use Folio Lens' : ''}
            </p>
            <div className="scene-mark" aria-hidden="true">
              §
            </div>
            <EditorContent editor={editor} />
          </article>
        </div>
      </section>
      <aside className="side" aria-label="Writing assistant">
        <Tabs.Root value={tab} onValueChange={setTab} className="side-tabs">
          <Tabs.List className="tabs side-tablist" aria-label="Writing assistant">
            <Tabs.Trigger value="suggestions">
              Suggestions{' '}
              {openSuggestions > 0 && (
                <Badge tone="ai" title="Pending suggestions">
                  {openSuggestions}
                </Badge>
              )}
            </Tabs.Trigger>
            <Tabs.Trigger value="context">
              Context{' '}
              {sceneIssues.length > 0 && (
                <Badge tone="warn" title="Open continuity issues">
                  {sceneIssues.length}
                </Badge>
              )}
            </Tabs.Trigger>
            <Tabs.Trigger value="research">Research</Tabs.Trigger>
            <Tabs.Trigger value="history">History</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="suggestions" className="side-panel">
            <SuggestionsPanel
              suggestions={suggestions.data ?? []}
              loading={suggestions.isPending}
              blockText={blockText}
              blockLabel={blockLabel}
              getCurrentBlock={() => (editor ? blockAtSelection(editor) : null)}
              editable={editable}
              onRequest={requestSuggestions}
              onAccept={accept}
              onReject={(s) => setSuggestionState(s, 'REJECTED')}
              onUnreject={(s) => setSuggestionState(s, 'PENDING')}
              onUndo={undo}
              onJump={jumpToBlock}
            />
          </Tabs.Content>
          <Tabs.Content value="context" className="side-panel">
            <ContextPanel
              issues={sceneIssues}
              facts={dna.data?.facts ?? []}
              sceneText={blockList.map((b) => b.text).join('\n')}
              editable={editable}
              checking={watched.pending}
              dnaHref={dnaHref}
              onCheck={checkScene}
              onJump={(i) => jumpToBlock(issueBlock(i))}
              onIssue={setIssue}
            />
          </Tabs.Content>
          <Tabs.Content value="research" className="side-panel">
            <ResearchPanel
              notes={notes.data ?? []}
              excerpts={excerpts.data ?? []}
              loading={notes.isPending}
              editable={editable}
              onCreate={async (body) => {
                await writerApi.createNote(wid, mid, { ...body, nodeId: sceneId });
                qc.invalidateQueries({ queryKey: writerKeys.notes(wid, mid) });
              }}
              onDelete={async (n) => {
                await writerApi.deleteNote(wid, mid, n.id).catch((err) => toast(err.message, 'bad'));
                qc.invalidateQueries({ queryKey: writerKeys.notes(wid, mid) });
              }}
              onInsert={insertCitation}
            />
          </Tabs.Content>
          <Tabs.Content value="history" className="side-panel">
            <HistoryPanel
              wid={wid}
              manuscriptId={mid}
              nodeId={sceneId}
              revisions={revisions.data ?? []}
              loading={revisions.isPending}
              currentRevision={sync.savedRevision}
              getContent={getContent}
              editable={editable}
              onRestore={restore}
            />
          </Tabs.Content>
        </Tabs.Root>
      </aside>
      <FolioLens
        open={Boolean(lens)}
        kind="W"
        text={lens?.text ?? ''}
        anchor={lens?.rect ?? null}
        actions={lensActions}
        result={lens?.result ?? null}
        onClose={() => setLens(null)}
        onAction={onLensAction}
        autoFocus
      />
      <MergeDialog
        conflict={sync.conflict}
        onClose={() => undefined}
        onUseTheirs={() => sync.resolveConflict('theirs', replaceContent)}
        onKeepMine={() => sync.resolveConflict('mine', replaceContent)}
      />
    </>
  );
}
