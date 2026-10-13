import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client.js';
import { useMe } from '@/features/auth/session.js';

export const adminKeys = {
  all: ['admin'],
  models: () => ['admin', 'models'],
  diff: () => ['admin', 'registry-diff'],
  overview: (days, model) => ['admin', 'overview', days, model ?? null],
  reconciliation: (days) => ['admin', 'reconciliation', days],
  infra: (days) => ['admin', 'infra', days],
};

/** Platform super admins only; the API answers 404 to everyone else, so this only decides what to show. */
export function useIsSuperAdmin() {
  return useMe().data?.user?.platformRole === 'SUPER_ADMIN';
}

export function useAdminModels(enabled = true) {
  return useQuery({ queryKey: adminKeys.models(), queryFn: () => api('/admin/models'), enabled });
}

export function useRegistryDiff(enabled = true) {
  return useQuery({ queryKey: adminKeys.diff(), queryFn: () => api('/admin/models/registry/diff'), enabled });
}

export function useAdminOverview(days, model, enabled = true) {
  const qs = new URLSearchParams({ days: String(days), ...(model ? { model } : {}) });
  return useQuery({ queryKey: adminKeys.overview(days, model), queryFn: () => api(`/admin/costs/overview?${qs}`), enabled, placeholderData: (prev) => prev });
}

export function useReconciliation(days, enabled = true) {
  return useQuery({ queryKey: adminKeys.reconciliation(days), queryFn: () => api(`/admin/costs/reconciliation?days=${days}`), enabled });
}

export function useInfra(days, enabled = true) {
  return useQuery({ queryKey: adminKeys.infra(days), queryFn: () => api(`/admin/costs/infra?days=${days}`), enabled });
}

export const adminApi = {
  patchModel: (id, body) => api(`/admin/models/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  addPrice: (id, body) => api(`/admin/models/${encodeURIComponent(id)}/prices`, { method: 'POST', body }),
  syncRegistry: () => api('/admin/models/registry/sync', { method: 'POST' }),
  rollup: (days) => api('/admin/costs/rollup', { method: 'POST', body: { days } }),
  importCsv: (provider, csv) => api('/admin/costs/reconciliation/import', { method: 'POST', body: { provider, csv } }),
  fetchProvider: (provider, days) => api('/admin/costs/reconciliation/fetch', { method: 'POST', body: { provider, days } }),
  addInfra: (body) => api('/admin/costs/infra', { method: 'POST', body }),
  importGcp: (days) => api('/admin/costs/infra/import-gcp', { method: 'POST', body: { days } }),
};

/** One-line summary of a reconciliation import for a toast. */
export function importSummary(results) {
  const count = (s) => results.filter((r) => r.status === s).length;
  const parts = [
    ['RECONCILED', 'reconciled'],
    ['VARIANCE', 'with a variance'],
    ['SKIPPED', 'skipped'],
    ['CONFLICT', 'already reconciled with a different amount'],
  ]
    .map(([s, label]) => (count(s) ? `${count(s)} ${label}` : null))
    .filter(Boolean);
  return parts.length ? `Days: ${parts.join(', ')}.` : 'No days in the file.';
}

/** Pre-fills the price form from the latest price so an admin only edits what changed. */
export function priceDraft(model) {
  const p = model?.prices?.find((x) => x.id === model.currentPriceId) ?? model?.prices?.[0];
  const local = model?.provider === 'local';
  return {
    unit: local ? 'CPU_HOUR' : 'MTOK',
    inputPerMTok: p?.inputPerMTok ?? '',
    outputPerMTok: local ? '' : (p?.outputPerMTok ?? ''),
    cachedInputPerMTok: p?.cachedInputPerMTok ?? '',
    effectiveFrom: '',
    sourceUrl: '',
    isDemo: false,
  };
}
