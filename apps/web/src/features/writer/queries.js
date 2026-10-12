import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '@/api/client.js';

export const writerKeys = {
  manuscripts: (wid) => ['manuscripts', wid],
  manuscript: (wid, id) => ['manuscript', wid, id],
  doc: (wid, id, nodeId) => ['scene-doc', wid, id, nodeId],
  revisions: (wid, id, nodeId) => ['revisions', wid, id, nodeId],
  revision: (wid, id, nodeId, rev) => ['revision', wid, id, nodeId, rev],
  suggestions: (wid, id, nodeId) => ['suggestions', wid, id, nodeId ?? null],
  dna: (wid, id) => ['dna', wid, id],
  continuity: (wid, id) => ['continuity', wid, id],
  notes: (wid, id) => ['research-notes', wid, id],
  excerpts: (wid) => ['excerpts', wid],
  compiled: (wid, id) => ['compiled', wid, id],
};

export const TERMINAL_RUN = new Set(['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'BUDGET_REJECTED']);
const POLL_MS = 1500;
const base = (wid, id) => `/workspaces/${wid}/manuscripts/${id}`;

export function useManuscripts(wid) {
  return useQuery({ queryKey: writerKeys.manuscripts(wid), queryFn: () => api(`/workspaces/${wid}/manuscripts`), enabled: Boolean(wid) });
}

export function useManuscript(wid, id) {
  return useQuery({ queryKey: writerKeys.manuscript(wid, id), queryFn: () => api(base(wid, id)), enabled: Boolean(wid && id), retry: false });
}

export function useSceneDoc(wid, id, nodeId) {
  return useQuery({
    queryKey: writerKeys.doc(wid, id, nodeId),
    queryFn: () => api(`${base(wid, id)}/nodes/${nodeId}/doc`),
    enabled: Boolean(wid && id && nodeId),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
}

export function useRevisions(wid, id, nodeId, enabled = true) {
  return useQuery({ queryKey: writerKeys.revisions(wid, id, nodeId), queryFn: () => api(`${base(wid, id)}/nodes/${nodeId}/doc/revisions`), enabled: Boolean(wid && id && nodeId && enabled) });
}

export function useRevision(wid, id, nodeId, rev) {
  return useQuery({
    queryKey: writerKeys.revision(wid, id, nodeId, rev),
    queryFn: () => api(`${base(wid, id)}/nodes/${nodeId}/doc/revisions/${rev}`),
    enabled: Boolean(wid && id && nodeId && rev != null),
    staleTime: Infinity,
  });
}

/** Suggestions for a scene; polls while any of their runs is still working. */
export function useSuggestions(wid, id, nodeId) {
  return useQuery({
    queryKey: writerKeys.suggestions(wid, id, nodeId),
    queryFn: () => api(`${base(wid, id)}/suggestions${nodeId ? `?nodeId=${nodeId}` : ''}`),
    enabled: Boolean(wid && id),
    refetchInterval: (q) => ((q.state.data ?? []).some((s) => s.run && !TERMINAL_RUN.has(s.run.status)) ? POLL_MS : false),
  });
}

export function useDna(wid, id) {
  return useQuery({ queryKey: writerKeys.dna(wid, id), queryFn: () => api(`${base(wid, id)}/dna`), enabled: Boolean(wid && id) });
}

export function useContinuity(wid, id) {
  return useQuery({ queryKey: writerKeys.continuity(wid, id), queryFn: () => api(`${base(wid, id)}/continuity`), enabled: Boolean(wid && id) });
}

export function useResearchNotes(wid, id) {
  return useQuery({ queryKey: writerKeys.notes(wid, id), queryFn: () => api(`${base(wid, id)}/research-notes`), enabled: Boolean(wid && id) });
}

export function useExcerpts(wid, enabled = true) {
  return useQuery({ queryKey: writerKeys.excerpts(wid), queryFn: () => api(`/workspaces/${wid}/excerpts`), enabled: Boolean(wid && enabled) });
}

export function useCompiled(wid, id) {
  return useQuery({ queryKey: writerKeys.compiled(wid, id), queryFn: () => api(`${base(wid, id)}/compiled`), enabled: Boolean(wid && id) });
}

/**
 * Watches background runs (DNA extraction, continuity checks) until each reaches a terminal state.
 * @returns {{ pending: boolean, runs: any[] }}
 */
export function useRunsWatch(wid, runIds) {
  const results = useQueries({
    queries: runIds.map((runId) => ({
      queryKey: ['run', wid, runId],
      queryFn: () => api(`/workspaces/${wid}/runs/${runId}`),
      enabled: Boolean(wid),
      refetchInterval: (q) => (q.state.data && TERMINAL_RUN.has(q.state.data.status) ? false : POLL_MS),
    })),
  });
  const runs = results.map((r) => r.data).filter(Boolean);
  return { pending: runIds.length > 0 && (runs.length < runIds.length || runs.some((r) => !TERMINAL_RUN.has(r.status))), runs };
}

export const writerApi = {
  base,
  createManuscript: (wid, body) => api(`/workspaces/${wid}/manuscripts`, { method: 'POST', body }),
  updateManuscript: (wid, id, body) => api(base(wid, id), { method: 'PATCH', body }),
  createNode: (wid, id, body) => api(`${base(wid, id)}/nodes`, { method: 'POST', body }),
  updateNode: (wid, id, nodeId, body) => api(`${base(wid, id)}/nodes/${nodeId}`, { method: 'PATCH', body }),
  deleteNode: (wid, id, nodeId) => api(`${base(wid, id)}/nodes/${nodeId}`, { method: 'DELETE' }),
  saveDoc: (wid, id, nodeId, body) => api(`${base(wid, id)}/nodes/${nodeId}/doc`, { method: 'PATCH', body }),
  restore: (wid, id, nodeId, rev, revision) => api(`${base(wid, id)}/nodes/${nodeId}/doc/revisions/${rev}/restore`, { method: 'POST', body: { revision } }),
  requestSuggestions: (wid, id, nodeId, body) => api(`${base(wid, id)}/nodes/${nodeId}/suggestions`, { method: 'POST', body }),
  updateSuggestion: (wid, sid, state) => api(`/workspaces/${wid}/suggestions/${sid}`, { method: 'PATCH', body: { state } }),
  createFact: (wid, id, body) => api(`${base(wid, id)}/dna/facts`, { method: 'POST', body }),
  updateFact: (wid, id, factId, body) => api(`${base(wid, id)}/dna/facts/${factId}`, { method: 'PATCH', body }),
  createLink: (wid, id, body) => api(`${base(wid, id)}/dna/links`, { method: 'POST', body }),
  updateLink: (wid, id, linkId, body) => api(`${base(wid, id)}/dna/links/${linkId}`, { method: 'PATCH', body }),
  extract: (wid, id, body = {}) => api(`${base(wid, id)}/dna/extract`, { method: 'POST', body }),
  checkContinuity: (wid, id, body = {}) => api(`${base(wid, id)}/continuity/check`, { method: 'POST', body }),
  updateIssue: (wid, id, issueId, state) => api(`${base(wid, id)}/continuity/${issueId}`, { method: 'PATCH', body: { state } }),
  createNote: (wid, id, body) => api(`${base(wid, id)}/research-notes`, { method: 'POST', body }),
  deleteNote: (wid, id, noteId) => api(`${base(wid, id)}/research-notes/${noteId}`, { method: 'DELETE' }),
  createExcerpt: (wid, body) => api(`/workspaces/${wid}/excerpts`, { method: 'POST', body }),
};
