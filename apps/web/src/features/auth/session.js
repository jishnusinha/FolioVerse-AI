import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api, ensureCsrf } from '@/api/client.js';

export const ME_KEY = ['me'];

/** The workspace the user last chose; validated against `/auth/me` on every read. */
export const useWorkspaceStore = create(
  persist((set) => ({ workspaceId: null, setWorkspaceId: (workspaceId) => set({ workspaceId }) }), { name: 'fv-workspace' }),
);

export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: () => api('/auth/me'), retry: false, staleTime: 5 * 60_000 });
}

/** @returns {{ id: string, name: string, kind: 'PERSONAL'|'TEAM', role: 'OWNER'|'ADMIN'|'EDITOR'|'VIEWER' } | null} */
export function useCurrentWorkspace() {
  const { data } = useMe();
  const stored = useWorkspaceStore((s) => s.workspaceId);
  const list = data?.workspaces ?? [];
  return list.find((w) => w.id === stored) ?? list.find((w) => w.kind === 'PERSONAL') ?? list[0] ?? null;
}

const ROLE_RANK = { VIEWER: 1, EDITOR: 2, ADMIN: 3, OWNER: 4 };

/** Mirrors the API's minimum-role checks so controls can be hidden; the API still enforces them. */
export function can(workspace, minRole) {
  return Boolean(workspace) && ROLE_RANK[workspace.role] >= ROLE_RANK[minRole];
}

/** Only same-app paths are accepted as post-login destinations. */
export function safeNext(next, fallback = '/app') {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}

/** @param {import('@tanstack/react-query').QueryClient} qc */
export async function signIn(qc, { email, password }) {
  await ensureCsrf();
  const res = await api('/auth/login', { method: 'POST', body: { email, password } });
  await qc.invalidateQueries({ queryKey: ME_KEY });
  return res;
}

/** @param {import('@tanstack/react-query').QueryClient} qc */
export async function register(qc, { email, password, displayName }) {
  await ensureCsrf();
  const res = await api('/auth/register', { method: 'POST', body: { email, password, displayName } });
  await qc.invalidateQueries({ queryKey: ME_KEY });
  return res;
}

/** @param {import('@tanstack/react-query').QueryClient} qc */
export async function signOut(qc) {
  await ensureCsrf();
  await api('/auth/logout', { method: 'POST' });
  useWorkspaceStore.getState().setWorkspaceId(null);
  qc.clear();
}
