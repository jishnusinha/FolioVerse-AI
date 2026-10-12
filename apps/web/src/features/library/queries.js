import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { api } from '@/api/client.js';

export const libraryKeys = {
  items: (wid, filter) => ['library-items', wid, filter ?? {}],
  allItems: (wid) => ['library-items', wid],
  item: (wid, id) => ['library-item', wid, id],
  annotations: (wid, id) => ['annotations', wid, id],
  bookmarks: (wid, id) => ['bookmarks', wid, id],
  collections: (wid) => ['collections', wid],
  stats: (wid) => ['library-stats', wid],
  metadata: (wid, q) => ['book-metadata', wid, q],
};

export const STATUSES = [
  ['TO_READ', 'To read'],
  ['READING', 'Currently reading'],
  ['FINISHED', 'Finished'],
  ['ABANDONED', 'Set aside'],
];
export const STATUS_LABEL = Object.fromEntries(STATUSES);
export const HIGHLIGHT_COLORS = ['amber', 'sage', 'rose', 'sky'];

const lib = (wid) => `/workspaces/${wid}/library`;
const qs = (o) => {
  const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v));
  return p.size ? `?${p}` : '';
};

/** @param {string} wid @param {{ status?: string, collectionId?: string, q?: string }} [filter] */
export function useLibraryItems(wid, filter = {}) {
  return useQuery({ queryKey: libraryKeys.items(wid, filter), queryFn: () => api(`${lib(wid)}/items${qs(filter)}`), enabled: Boolean(wid) });
}

export function useLibraryItem(wid, id) {
  return useQuery({ queryKey: libraryKeys.item(wid, id), queryFn: () => api(`${lib(wid)}/items/${id}`), enabled: Boolean(wid && id), retry: false });
}

export function useCollections(wid) {
  return useQuery({ queryKey: libraryKeys.collections(wid), queryFn: () => api(`${lib(wid)}/collections`), enabled: Boolean(wid) });
}

export function useLibraryStats(wid) {
  return useQuery({ queryKey: libraryKeys.stats(wid), queryFn: () => api(`${lib(wid)}/stats`), enabled: Boolean(wid) });
}

export function useBookmarks(wid, id) {
  return useQuery({ queryKey: libraryKeys.bookmarks(wid, id), queryFn: () => api(`${lib(wid)}/items/${id}/bookmarks`), enabled: Boolean(wid && id) });
}

export function useMetadataSearch(wid, q) {
  return useQuery({
    queryKey: libraryKeys.metadata(wid, q),
    queryFn: () => api(`${lib(wid)}/metadata/search?q=${encodeURIComponent(q)}`),
    enabled: Boolean(wid && q.trim().length >= 2),
    staleTime: 5 * 60_000,
  });
}

/** Merges a `?since=` delta into the cached list: updated rows replace, tombstones remove. */
export function mergeAnnotations(list, delta) {
  const byId = new Map(list.map((a) => [a.id, a]));
  for (const a of delta) {
    if (a.deletedAt) byId.delete(a.id);
    else byId.set(a.id, a);
  }
  return [...byId.values()].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
}

/**
 * Annotations for one book. The first load fetches the live list; later refreshes (window focus, `sync()`) ask
 * only for changes since the last server time, so edits and deletions from another device arrive as a delta.
 */
export function useAnnotations(wid, id) {
  const qc = useQueryClient();
  const key = useMemo(() => libraryKeys.annotations(wid, id), [wid, id]);
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const prev = qc.getQueryData(key);
      if (!prev) {
        const r = await api(`${lib(wid)}/items/${id}/annotations`);
        return { list: r.annotations, serverTime: r.serverTime };
      }
      const r = await api(`${lib(wid)}/items/${id}/annotations?since=${encodeURIComponent(prev.serverTime)}`);
      return { list: mergeAnnotations(prev.list, r.annotations), serverTime: r.serverTime };
    },
    enabled: Boolean(wid && id),
  });
  const sync = useCallback(() => qc.invalidateQueries({ queryKey: key }), [qc, key]);
  useEffect(() => {
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, [sync]);
  /** Applies a local change immediately; the server copy replaces it on the next sync. */
  const setLocal = useCallback(
    (fn) => qc.setQueryData(key, (prev) => (prev ? { ...prev, list: fn(prev.list) } : prev)),
    [qc, key],
  );
  return { ...query, annotations: query.data?.list ?? [], sync, setLocal };
}

export const libraryApi = {
  createItem: (wid, body) => api(`${lib(wid)}/items`, { method: 'POST', body }),
  updateItem: (wid, id, body) => api(`${lib(wid)}/items/${id}`, { method: 'PATCH', body }),
  removeItem: (wid, id) => api(`${lib(wid)}/items/${id}`, { method: 'DELETE' }),
  saveProgress: (wid, id, body) => api(`${lib(wid)}/items/${id}/progress`, { method: 'PUT', body }),
  createAnnotation: (wid, id, body) => api(`${lib(wid)}/items/${id}/annotations`, { method: 'POST', body }),
  updateAnnotation: (wid, id, aid, body) => api(`${lib(wid)}/items/${id}/annotations/${aid}`, { method: 'PATCH', body }),
  removeAnnotation: (wid, id, aid) => api(`${lib(wid)}/items/${id}/annotations/${aid}`, { method: 'DELETE' }),
  createBookmark: (wid, id, body) => api(`${lib(wid)}/items/${id}/bookmarks`, { method: 'POST', body }),
  removeBookmark: (wid, id, bid) => api(`${lib(wid)}/items/${id}/bookmarks/${bid}`, { method: 'DELETE' }),
  explain: (wid, id, body) => api(`${lib(wid)}/items/${id}/explain`, { method: 'POST', body }),
  excerpt: (wid, id, body) => api(`${lib(wid)}/items/${id}/excerpts`, { method: 'POST', body }),
  createCollection: (wid, body) => api(`${lib(wid)}/collections`, { method: 'POST', body }),
  removeCollection: (wid, cid) => api(`${lib(wid)}/collections/${cid}`, { method: 'DELETE' }),
  addToCollection: (wid, cid, itemId) => api(`${lib(wid)}/collections/${cid}/items`, { method: 'POST', body: { itemId } }),
  removeFromCollection: (wid, cid, itemId) => api(`${lib(wid)}/collections/${cid}/items/${itemId}`, { method: 'DELETE' }),
  fileUrl: (wid, source) => `/workspaces/${wid}/sources/${source.id}/versions/${source.currentVersionId}/file`,
};
