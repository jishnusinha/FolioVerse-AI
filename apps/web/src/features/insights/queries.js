import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client.js';

export const insightKeys = {
  actions: () => ['insight-actions'],
  artifacts: (wid, params) => ['artifacts', wid, params ?? {}],
  artifact: (wid, id) => ['artifact', wid, id],
  notes: (wid, sourceId) => ['notes', wid, sourceId ?? null],
  search: (wid, q, semantic) => ['search', wid, q, semantic],
  diff: (wid, sourceId, versionId) => ['diff', wid, sourceId, versionId],
};

const qs = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();

export function useInsightActions() {
  return useQuery({ queryKey: insightKeys.actions(), queryFn: () => api('/insight-actions'), staleTime: Infinity });
}

/** @param {string | undefined} wid @param {{ sourceId?: string, projectId?: string, kind?: string, q?: string, archived?: boolean }} [params] */
export function useArtifacts(wid, params = {}) {
  const query = qs(params);
  return useQuery({
    queryKey: insightKeys.artifacts(wid, params),
    queryFn: () => api(`/workspaces/${wid}/artifacts${query ? `?${query}` : ''}`),
    enabled: Boolean(wid),
  });
}

export function useArtifact(wid, id) {
  return useQuery({ queryKey: insightKeys.artifact(wid, id), queryFn: () => api(`/workspaces/${wid}/artifacts/${id}`), enabled: Boolean(wid && id) });
}

export function useNotes(wid, sourceId) {
  return useQuery({
    queryKey: insightKeys.notes(wid, sourceId),
    queryFn: () => api(`/workspaces/${wid}/notes${sourceId ? `?sourceId=${sourceId}` : ''}`),
    enabled: Boolean(wid),
  });
}

/** Workspace search. Keyword results come from Postgres; semantic passages from the AI service. */
export function useSearch(wid, q, { semantic = true, enabled = true } = {}) {
  const term = q.trim();
  return useQuery({
    queryKey: insightKeys.search(wid, term, semantic),
    queryFn: ({ signal }) => api(`/workspaces/${wid}/search?${qs({ q: term, semantic: semantic ? undefined : 'false' })}`, { signal }),
    enabled: Boolean(wid && term.length >= 2 && enabled),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useVersionDiff(wid, sourceId, versionId, enabled = true) {
  return useQuery({
    queryKey: insightKeys.diff(wid, sourceId, versionId),
    queryFn: () => api(`/workspaces/${wid}/sources/${sourceId}/versions/${versionId}/diff`),
    enabled: Boolean(wid && sourceId && versionId && enabled),
  });
}
