import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client.js';

export const costKeys = {
  budgets: (wid) => ['budgets', wid],
  anomalies: (wid) => ['costs', wid, 'anomalies'],
  notifications: (wid) => ['notifications', wid],
};

export function useBudgets(wid) {
  return useQuery({ queryKey: costKeys.budgets(wid), queryFn: () => api(`/workspaces/${wid}/budgets`), enabled: Boolean(wid) });
}

export function useNotifications(wid, enabled = true) {
  return useQuery({ queryKey: costKeys.notifications(wid), queryFn: () => api(`/workspaces/${wid}/notifications`), enabled: Boolean(wid && enabled) });
}

export const costApi = {
  createBudget: (wid, body) => api(`/workspaces/${wid}/budgets`, { method: 'POST', body }),
  updateBudget: (wid, id, body) => api(`/workspaces/${wid}/budgets/${id}`, { method: 'PATCH', body }),
  deleteBudget: (wid, id) => api(`/workspaces/${wid}/budgets/${id}`, { method: 'DELETE' }),
  estimate: (wid, body) => api(`/workspaces/${wid}/costs/estimate`, { method: 'POST', body }),
  readAllNotifications: (wid) => api(`/workspaces/${wid}/notifications/read-all`, { method: 'POST' }),
};

export const SCOPE_LABEL = { WORKSPACE: 'Workspace', PROJECT: 'Project', USER: 'Member' };

/**
 * Plain-language name of the budget that stopped a run, from a BUDGET_REJECTED response.
 * @param {{ scope?: string } | null | undefined} budget
 */
export function budgetScopeText(budget) {
  if (budget?.scope === 'USER') return 'your personal AI budget';
  if (budget?.scope === 'PROJECT') return 'this project’s AI budget';
  return 'the workspace AI budget';
}

/**
 * Share of a budget used, finalized and reserved, as 0–100 values for a stacked bar.
 * @param {{ limit: string, spent: string, reserved: string }} period
 */
export function budgetUse(period) {
  const limit = Number(period?.limit ?? 0);
  const pct = (v) => (limit > 0 ? Math.min(100, (Number(v ?? 0) / limit) * 100) : 0);
  return { spent: pct(period?.spent), reserved: pct(period?.reserved) };
}

/**
 * Token mix shares (uncached input, cached input, output) in whole percent.
 * @param {{ input: number, cachedInput: number, output: number }} t
 */
export function tokenMix(t) {
  const cached = Math.min(t?.cachedInput ?? 0, t?.input ?? 0);
  const parts = [(t?.input ?? 0) - cached, cached, t?.output ?? 0];
  const total = parts.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const pct = parts.map((p) => Math.round((p / total) * 100));
  pct[0] += 100 - pct.reduce((a, b) => a + b, 0);
  return { uncached: pct[0], cached: pct[1], output: pct[2], counts: parts };
}
