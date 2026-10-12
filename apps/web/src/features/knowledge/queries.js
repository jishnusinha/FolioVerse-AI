import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client.js';
import { BUSY_INGEST } from '@/shared/states.js';

export const keys = {
  projects: (wid) => ['projects', wid],
  project: (wid, pid) => ['project', wid, pid],
  folders: (wid, pid) => ['folders', wid, pid],
  sources: (wid, pid) => ['sources', wid, pid],
  source: (wid, sid) => ['source', wid, sid],
  trash: (wid) => ['trash', wid],
  members: (wid) => ['members', wid],
};

const POLL_MS = 3000;

export function useProjects(wid) {
  return useQuery({ queryKey: keys.projects(wid), queryFn: () => api(`/workspaces/${wid}/projects`), enabled: Boolean(wid) });
}

export function useProject(wid, pid) {
  return useQuery({ queryKey: keys.project(wid, pid), queryFn: () => api(`/workspaces/${wid}/projects/${pid}`), enabled: Boolean(wid && pid) });
}

export function useFolders(wid, pid) {
  return useQuery({ queryKey: keys.folders(wid, pid), queryFn: () => api(`/workspaces/${wid}/projects/${pid}/folders`), enabled: Boolean(wid && pid) });
}

/** Sources of a project; polls while any of them is still moving through ingestion. */
export function useSources(wid, pid) {
  return useQuery({
    queryKey: keys.sources(wid, pid),
    queryFn: () => api(`/workspaces/${wid}/projects/${pid}/sources`),
    enabled: Boolean(wid && pid),
    refetchInterval: (q) => (q.state.data?.some((s) => BUSY_INGEST.has(s.ingestionState)) ? POLL_MS : false),
  });
}

export function useSource(wid, sid) {
  return useQuery({
    queryKey: keys.source(wid, sid),
    queryFn: () => api(`/workspaces/${wid}/sources/${sid}`),
    enabled: Boolean(wid && sid),
    refetchInterval: (q) => (BUSY_INGEST.has(q.state.data?.ingestionState) ? POLL_MS : false),
  });
}

export function useTrash(wid) {
  return useQuery({ queryKey: keys.trash(wid), queryFn: () => api(`/workspaces/${wid}/trash`), enabled: Boolean(wid) });
}
