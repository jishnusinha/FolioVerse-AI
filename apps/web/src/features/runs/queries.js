import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client.js';

export const runKeys = {
  runs: (wid, params) => ['runs', wid, params ?? {}],
  receipt: (wid, runId) => ['receipt', wid, runId],
  trace: (wid, runId) => ['trace', wid, runId],
  graph: (wid, name) => ['graph', wid, name],
  threads: (wid, sourceId) => ['threads', wid, sourceId],
  thread: (wid, threadId) => ['thread', wid, threadId],
  models: () => ['models'],
  budget: (wid) => ['budget', wid],
  costSummary: (wid, days) => ['costs', wid, 'summary', days],
  costEntries: (wid) => ['costs', wid, 'entries'],
};

export function useRuns(wid, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  return useQuery({
    queryKey: runKeys.runs(wid, params),
    queryFn: () => api(`/workspaces/${wid}/runs${qs ? `?${qs}` : ''}`),
    enabled: Boolean(wid),
  });
}

const SETTLE_WINDOW_MS = 60_000;

/** Run receipt; re-polls for a minute after the run ends while the ledger settles the final cost. */
export function useReceipt(wid, runId, enabled = true) {
  return useQuery({
    queryKey: runKeys.receipt(wid, runId),
    queryFn: () => api(`/workspaces/${wid}/runs/${runId}/receipt`),
    enabled: Boolean(wid && runId && enabled),
    refetchInterval: (q) => {
      const d = q.state.data;
      const finishedAt = d?.run?.finishedAt ? new Date(d.run.finishedAt).getTime() : 0;
      return d?.cost?.tier === 'PREFLIGHT_ESTIMATE' && Date.now() - finishedAt < SETTLE_WINDOW_MS ? 2000 : false;
    },
  });
}

export function useTrace(wid, runId) {
  return useQuery({ queryKey: runKeys.trace(wid, runId), queryFn: () => api(`/workspaces/${wid}/runs/${runId}/trace`), enabled: Boolean(wid && runId) });
}

/** Graph structure from LangGraph `get_graph()`; static per graph name. */
export function useGraphSpec(wid, name) {
  return useQuery({
    queryKey: runKeys.graph(wid, name),
    queryFn: () => api(`/workspaces/${wid}/graphs/${name}`),
    enabled: Boolean(wid && name),
    staleTime: Infinity,
    retry: false,
  });
}

export function useThreads(wid, sourceId) {
  return useQuery({
    queryKey: runKeys.threads(wid, sourceId),
    queryFn: () => api(`/workspaces/${wid}/threads?sourceId=${sourceId}`),
    enabled: Boolean(wid && sourceId),
  });
}

export function useThread(wid, threadId) {
  return useQuery({ queryKey: runKeys.thread(wid, threadId), queryFn: () => api(`/workspaces/${wid}/threads/${threadId}`), enabled: Boolean(wid && threadId) });
}

export function useModels() {
  return useQuery({ queryKey: runKeys.models(), queryFn: () => api('/models'), staleTime: 5 * 60_000 });
}

export function useBudget(wid) {
  return useQuery({ queryKey: runKeys.budget(wid), queryFn: () => api(`/workspaces/${wid}/budget`), enabled: Boolean(wid) });
}

export function useCostSummary(wid, days = 30) {
  return useQuery({ queryKey: runKeys.costSummary(wid, days), queryFn: () => api(`/workspaces/${wid}/costs/summary?days=${days}`), enabled: Boolean(wid) });
}

export function useCostEntries(wid) {
  return useQuery({ queryKey: runKeys.costEntries(wid), queryFn: () => api(`/workspaces/${wid}/costs/entries?limit=300`), enabled: Boolean(wid) });
}
