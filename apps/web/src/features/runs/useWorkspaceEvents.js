import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { readEventStream } from '@/api/client.js';
import { BUSY_INGEST } from '@/shared/states.js';

const MAX_BACKOFF_MS = 30_000;

/**
 * Applies one workspace event to cached queries. Ingestion stages patch source rows in place so stage
 * tracks move without a refetch; terminal stages refetch to pick up page counts and errors.
 * @param {import('@tanstack/react-query').QueryClient} qc
 * @param {string} wid
 * @param {{ type: string, data?: any }} env
 */
export function applyWorkspaceEvent(qc, wid, env) {
  if (env.type === 'ingestion.stage' && env.data?.sourceId) {
    const { sourceId, sourceVersionId, state } = env.data;
    const patchVersion = (v) => (v && v.id === sourceVersionId ? { ...v, ingestionState: state } : v);
    const patchSource = (s) =>
      s.id === sourceId
        ? {
            ...s,
            ingestionState: !s.currentVersion || s.currentVersion.id === sourceVersionId ? state : s.ingestionState,
            currentVersion: patchVersion(s.currentVersion),
            versions: s.versions?.map(patchVersion),
          }
        : s;
    qc.setQueriesData({ queryKey: ['sources', wid] }, (rows) => (Array.isArray(rows) ? rows.map(patchSource) : rows));
    qc.setQueryData(['source', wid, sourceId], (s) => (s ? patchSource(s) : s));
    if (!BUSY_INGEST.has(state)) {
      qc.invalidateQueries({ queryKey: ['sources', wid] });
      qc.invalidateQueries({ queryKey: ['source', wid, sourceId] });
      qc.invalidateQueries({ queryKey: ['pages', wid, sourceVersionId] });
    }
  } else if (env.type === 'notification') {
    qc.invalidateQueries({ queryKey: ['notifications', wid] });
  }
}

/**
 * Follows the workspace event stream (ingestion progress, notifications) for the signed-in workspace.
 * Reconnects with Last-Event-ID; a 204 means the server has no stream for this workspace.
 * @param {string | undefined} wid
 */
export function useWorkspaceEvents(wid) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!wid) return undefined;
    const ac = new AbortController();
    let lastId;
    (async () => {
      let attempt = 0;
      while (!ac.signal.aborted) {
        try {
          const status = await readEventStream(`/workspaces/${wid}/events`, {
            lastEventId: lastId,
            signal: ac.signal,
            onEvent(raw) {
              if (raw.id) lastId = raw.id;
              try {
                applyWorkspaceEvent(qc, wid, JSON.parse(raw.data));
              } catch {
                /* ignore malformed events */
              }
            },
          });
          if (status === 204) return;
          attempt = 0;
        } catch (e) {
          if (ac.signal.aborted) return;
          const st = /** @type {any} */ (e)?.status;
          if (st === 401 || st === 403 || st === 404) return;
          attempt += 1;
        }
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS)));
      }
    })();
    return () => ac.abort();
  }, [wid, qc]);
}
