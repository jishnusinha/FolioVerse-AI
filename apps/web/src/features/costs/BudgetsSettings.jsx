import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client.js';
import { can, useCurrentWorkspace } from '@/features/auth/session.js';
import { useProjects } from '@/features/knowledge/queries.js';
import { formatUsd } from '@/shared/format.js';
import { Button, Callout, Dialog, Empty, Field, Input, Select, Skeleton, toast } from '@/shared/ui/index.js';
import { SCOPE_LABEL, budgetUse, costApi, costKeys, useBudgets } from './queries.js';

const DEC = /^\d{1,10}(\.\d{1,8})?$/;

/** "75, 90, 100" → [75, 90, 100]; null when any value is outside 1–100. */
export function parseThresholds(text) {
  const parts = String(text)
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (!parts.length || parts.length > 5 || parts.some((n) => !Number.isInteger(n) || n < 1 || n > 100)) return null;
  return [...new Set(parts)].sort((a, b) => a - b);
}

function useMembers(wid, enabled) {
  return useQuery({ queryKey: ['members', wid], queryFn: () => api(`/workspaces/${wid}/members`), enabled: Boolean(wid && enabled) });
}

/** Settings → Budgets: workspace, project and member budgets. Admins edit; everyone else reads. */
export function BudgetsSettings() {
  const workspace = useCurrentWorkspace();
  const wid = workspace?.id;
  const admin = can(workspace, 'ADMIN');
  const budgets = useBudgets(wid);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(/** @type {any} */ (null));
  const refresh = () => {
    qc.invalidateQueries({ queryKey: costKeys.budgets(wid) });
    qc.invalidateQueries({ queryKey: ['costs', wid] });
  };
  const remove = async (b) => {
    if (!window.confirm(`Delete “${b.label}”? Runs will no longer be checked against it.`)) return;
    try {
      await costApi.deleteBudget(wid, b.id);
      toast('Budget deleted', 'ok');
      refresh();
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <p className="muted">
        Budgets cap AI API spend. A hard limit rejects a run before any model call when its estimate does not fit; a soft limit only alerts. Every budget that
        applies to a run must have room: the workspace budget, the budget of the run’s project and the budget of the person running it. Local compute is not
        counted.
      </p>
      {!admin && <Callout>Only workspace admins and owners can change budgets. You see the workspace and project budgets and your own.</Callout>}
      {budgets.isPending ? (
        <Skeleton height={80} />
      ) : budgets.error ? (
        <Callout tone="bad">Budgets could not be loaded.</Callout>
      ) : !budgets.data.length ? (
        <Empty>No budgets yet.</Empty>
      ) : (
        <div style={{ overflow: 'auto' }}>
          <table className="table">
            <caption className="sr">Budgets in this workspace</caption>
            <thead>
              <tr>
                <th scope="col">Budget</th>
                <th scope="col">Period</th>
                <th scope="col">Type</th>
                <th scope="col" className="num">
                  Used this period
                </th>
                <th scope="col">Alerts</th>
                {admin && (
                  <th scope="col">
                    <span className="sr">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {budgets.data.map((b) => {
                const u = budgetUse(b.current);
                return (
                  <tr key={b.id}>
                    <td>
                      <span className="badge">{SCOPE_LABEL[b.scope]}</span> {b.label}
                    </td>
                    <td>{b.period === 'DAILY' ? 'Daily' : 'Monthly'}</td>
                    <td>{b.hard ? 'Hard limit' : 'Soft limit'}</td>
                    <td className="num">
                      <span className="mono">
                        {formatUsd(b.current.spent, { min: 2 })} of {formatUsd(b.current.limit, { min: 2 })}
                      </span>
                      <div className="bar" style={{ marginTop: 4 }} role="img" aria-label={`${u.spent.toFixed(0)}% used, ${u.reserved.toFixed(0)}% reserved`}>
                        <i style={{ width: `${u.spent}%` }} />
                        <i style={{ width: `${u.reserved}%`, background: 'var(--fv-ai-line)' }} />
                      </div>
                    </td>
                    <td className="mono">{b.alertThresholds.map((t) => `${t}%`).join(' · ')}</td>
                    {admin && (
                      <td className="row" style={{ justifyContent: 'flex-end' }}>
                        <Button size="sm" onClick={() => setEditing(b)} aria-label={`Edit ${b.label}`}>
                          Edit
                        </Button>
                        {b.scope !== 'WORKSPACE' && (
                          <Button size="sm" variant="ghost" onClick={() => remove(b)} aria-label={`Delete ${b.label}`}>
                            Delete
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {admin && <NewBudget wid={wid} existing={budgets.data ?? []} onDone={refresh} />}
      <EditBudget wid={wid} budget={editing} onClose={() => setEditing(null)} onDone={refresh} />
    </div>
  );
}

function NewBudget({ wid, existing, onDone }) {
  const [form, setForm] = useState({ scope: 'PROJECT', ref: '', period: 'MONTHLY', limit: '', hard: true, alerts: '75, 90, 100' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const projects = useProjects(wid);
  const members = useMembers(wid, form.scope === 'USER');
  const taken = new Set(existing.filter((b) => b.scope === form.scope).map((b) => b.scopeRefId));
  const targets =
    form.scope === 'PROJECT'
      ? (projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))
      : form.scope === 'USER'
        ? (members.data ?? []).map((m) => ({ value: m.userId, label: `${m.displayName} (${m.email})` }))
        : [];
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value, ...(k === 'scope' ? { ref: '' } : {}) }));
  const submit = async (e) => {
    e.preventDefault();
    const alertThresholds = parseThresholds(form.alerts);
    if (!DEC.test(form.limit)) return setError('Enter the limit in USD, for example 10 or 2.50.');
    if (!alertThresholds) return setError('Alert thresholds are whole percentages between 1 and 100, separated by commas.');
    if (form.scope !== 'WORKSPACE' && !form.ref) return setError(`Choose the ${form.scope === 'PROJECT' ? 'project' : 'member'} this budget applies to.`);
    setError('');
    setBusy(true);
    try {
      await costApi.createBudget(wid, { scope: form.scope, ...(form.scope !== 'WORKSPACE' ? { scopeRefId: form.ref } : {}), period: form.period, limitAmount: form.limit, hard: form.hard, alertThresholds });
      toast('Budget created', 'ok');
      setForm((f) => ({ ...f, ref: '', limit: '' }));
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card pad" onSubmit={submit} aria-labelledby="new-budget-h">
      <h2 id="new-budget-h" className="sect-h">
        Add a budget
      </h2>
      <div className="form" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginTop: 10 }}>
        <Field label="Applies to">
          <Select value={form.scope} onChange={set('scope')}>
            <option value="PROJECT">A project</option>
            <option value="USER">A member</option>
          </Select>
        </Field>
        <Field label={form.scope === 'PROJECT' ? 'Project' : 'Member'}>
          <Select value={form.ref} onChange={set('ref')}>
            <option value="">Choose…</option>
            {targets.map((t) => (
              <option key={t.value} value={t.value} disabled={taken.has(t.value)}>
                {t.label}
                {taken.has(t.value) ? ' (has a budget)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Period">
          <Select value={form.period} onChange={set('period')}>
            <option value="MONTHLY">Monthly</option>
            <option value="DAILY">Daily</option>
          </Select>
        </Field>
        <Field label="Limit (USD)">
          <Input inputMode="decimal" value={form.limit} onChange={set('limit')} placeholder="10.00" />
        </Field>
        <Field label="Alert at (%)" hint="Comma-separated, up to five">
          <Input value={form.alerts} onChange={set('alerts')} />
        </Field>
        <label className="row" style={{ alignSelf: 'end', paddingBottom: 8 }}>
          <input type="checkbox" checked={form.hard} onChange={set('hard')} /> Hard limit (reject runs that do not fit)
        </label>
      </div>
      {error && (
        <p role="alert" style={{ color: 'var(--fv-bad)', marginTop: 8 }}>
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={busy} style={{ marginTop: 12 }}>
        Add budget
      </Button>
    </form>
  );
}

function EditBudget({ wid, budget, onClose, onDone }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const current = form ?? (budget ? { limit: budget.limit, hard: budget.hard, period: budget.period, alerts: budget.alertThresholds.join(', ') } : null);
  const close = () => {
    setForm(null);
    setError('');
    onClose();
  };
  const set = (k) => (e) => setForm({ ...current, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    const alertThresholds = parseThresholds(current.alerts);
    if (!DEC.test(current.limit)) return setError('Enter the limit in USD, for example 10 or 2.50.');
    if (!alertThresholds) return setError('Alert thresholds are whole percentages between 1 and 100, separated by commas.');
    try {
      await costApi.updateBudget(wid, budget.id, { limitAmount: current.limit, hard: current.hard, period: current.period, alertThresholds });
      toast('Budget updated', 'ok');
      onDone();
      close();
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <Dialog
      open={Boolean(budget)}
      onOpenChange={(o) => !o && close()}
      title={budget ? `Edit ${budget.label}` : 'Edit budget'}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      {current && (
        <div className="form">
          <Field label="Limit (USD)" hint="Applies to the current period immediately">
            <Input inputMode="decimal" value={current.limit} onChange={set('limit')} />
          </Field>
          <Field label="Period" hint="Changing the period starts a new one now">
            <Select value={current.period} onChange={set('period')}>
              <option value="MONTHLY">Monthly</option>
              <option value="DAILY">Daily</option>
            </Select>
          </Field>
          <Field label="Alert at (%)">
            <Input value={current.alerts} onChange={set('alerts')} />
          </Field>
          <label className="row">
            <input type="checkbox" checked={current.hard} onChange={set('hard')} /> Hard limit (reject runs that do not fit)
          </label>
          {error && (
            <p role="alert" style={{ color: 'var(--fv-bad)' }}>
              {error}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
