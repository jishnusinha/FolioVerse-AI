import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { draftKey, draftStore } from './drafts.js';
import { writerApi, writerKeys } from './queries.js';

export const AUTOSAVE_MS = 1200;
const DRAFT_MS = 300;
const OFFLINE_RETRY_MS = 5000;

/**
 * Keeps one scene in sync with the API: debounced autosave with `revision` optimistic concurrency, a local
 * draft on every change, offline retry, and a conflict record on 409 for the merge dialog.
 * @param {{ wid: string, manuscriptId: string, nodeId: string, initial: { revision: number, content: any }, getContent: () => any, enabled: boolean }} p
 */
export function useSceneSync({ wid, manuscriptId, nodeId, initial, getContent, enabled }) {
  const qc = useQueryClient();
  const revision = useRef(initial.revision);
  const dirty = useRef(false);
  const inflight = useRef(/** @type {Promise<any> | null} */ (null));
  const timer = useRef(0);
  const draftTimer = useRef(0);
  const [status, setStatus] = useState(/** @type {'saved'|'dirty'|'saving'|'offline'|'conflict'|'error'} */ ('saved'));
  const [savedRevision, setSavedRevision] = useState(initial.revision);
  const [conflict, setConflict] = useState(/** @type {any} */ (null));
  const [error, setError] = useState('');
  const key = draftKey(wid, nodeId);

  const applySaved = useCallback(
    (res) => {
      revision.current = res.revision;
      setSavedRevision(res.revision);
      qc.setQueryData(writerKeys.manuscript(wid, manuscriptId), (m) =>
        m ? { ...m, stats: res.stats ?? m.stats, nodes: m.nodes.map((n) => (n.id === nodeId ? { ...n, wordCount: res.wordCount } : n)) } : m,
      );
      qc.invalidateQueries({ queryKey: writerKeys.revisions(wid, manuscriptId, nodeId) });
      if (res.staleSuggestionIds?.length || res.origin === 'POST_AI' || res.origin === 'UNDO') qc.invalidateQueries({ queryKey: writerKeys.suggestions(wid, manuscriptId, nodeId) });
    },
    [qc, wid, manuscriptId, nodeId],
  );

  /** Sends `content` (or the editor's current document) with the known revision. */
  const send = useCallback(
    async (extra = {}, content = getContent()) => {
      const body = { content, revision: revision.current, ...extra };
      const res = await writerApi.saveDoc(wid, manuscriptId, nodeId, body);
      applySaved(res);
      return res;
    },
    [wid, manuscriptId, nodeId, getContent, applySaved],
  );

  const save = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (inflight.current) await inflight.current.catch(() => undefined);
    if (!dirty.current) return;
    dirty.current = false;
    setStatus('saving');
    const content = getContent();
    const p = send({}, content);
    inflight.current = p;
    try {
      await p;
      if (!dirty.current) {
        setStatus('saved');
        draftStore.remove(key);
      } else timer.current = window.setTimeout(() => save(), AUTOSAVE_MS);
      setError('');
    } catch (err) {
      dirty.current = true;
      if (err.code === 'REVISION_CONFLICT' && err.problem?.current) {
        setConflict({ mine: content, theirs: err.problem.current });
        setStatus('conflict');
      } else if (!err.status) {
        setStatus('offline');
        timer.current = window.setTimeout(() => save(), OFFLINE_RETRY_MS);
      } else {
        setStatus('error');
        setError(err.message);
      }
    } finally {
      if (inflight.current === p) inflight.current = null;
    }
  }, [getContent, send, key]);

  /** Call on every document change. */
  const onChange = useCallback(() => {
    if (!enabled) return;
    dirty.current = true;
    setStatus((s) => (s === 'conflict' ? s : 'dirty'));
    window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => draftStore.put(key, { content: getContent(), baseRevision: revision.current, savedAt: new Date().toISOString() }), DRAFT_MS);
    if (!conflict) {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => save(), AUTOSAVE_MS);
    }
  }, [enabled, key, getContent, save, conflict]);

  /** Saves pending edits now (before accept/undo/restore, on Ctrl+S and on leaving the scene). */
  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (dirty.current && !conflict) await save();
    else if (inflight.current) await inflight.current.catch(() => undefined);
  }, [save, conflict]);

  /** Applies a document produced outside typing (accept, undo) as one save with an action. */
  const commit = useCallback(
    async (content, extra) => {
      await flush();
      setStatus('saving');
      try {
        const res = await send(extra, content);
        setStatus(dirty.current ? 'dirty' : 'saved');
        draftStore.remove(key);
        return res;
      } catch (err) {
        setStatus(dirty.current ? 'dirty' : 'saved');
        if (err.code === 'REVISION_CONFLICT' && err.problem?.current) {
          setConflict({ mine: getContent(), theirs: err.problem.current });
          setStatus('conflict');
        }
        throw err;
      }
    },
    [flush, send, key, getContent],
  );

  const resolveConflict = useCallback(
    async (choice, setContent) => {
      const c = conflict;
      if (!c) return;
      setConflict(null);
      revision.current = c.theirs.revision;
      if (choice === 'theirs') {
        setContent(c.theirs.content);
        dirty.current = false;
        setSavedRevision(c.theirs.revision);
        setStatus('saved');
        draftStore.remove(key);
      } else {
        dirty.current = true;
        await save();
      }
    },
    [conflict, key, save],
  );

  /** After a restore the server holds the restored content at `res.revision`. */
  const adopt = useCallback(
    (res) => {
      applySaved(res);
      dirty.current = false;
      setStatus('saved');
      draftStore.remove(key);
    },
    [key, applySaved],
  );

  useEffect(() => {
    const warn = (e) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      window.clearTimeout(draftTimer.current);
      window.clearTimeout(timer.current);
      if (!dirty.current) return;
      const content = getContent();
      draftStore.put(key, { content, baseRevision: revision.current, savedAt: new Date().toISOString() });
      send({}, content)
        .then(() => draftStore.remove(key))
        .catch(() => undefined);
    };
  }, [send, getContent, key]);

  return { status, error, savedRevision, revision, conflict, onChange, flush, commit, resolveConflict, adopt };
}
