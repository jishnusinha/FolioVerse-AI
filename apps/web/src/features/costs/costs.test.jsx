import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '@/test/render.jsx';
import { createFakeApi, installFakeFetch } from '@/test/fakeApi.js';
import { importSummary, priceDraft } from '@/features/admin/queries.js';
import { useWorkspaceStore } from '@/features/auth/session.js';
import { allCommands } from '@/shared/commands.js';
import { parseThresholds } from './BudgetsSettings.jsx';
import { budgetScopeText, budgetUse, tokenMix } from './queries.js';

describe('cost helpers', () => {
  it('splits the token mix into whole percentages that add up to 100', () => {
    expect(tokenMix({ input: 1000, cachedInput: 250, output: 500 })).toEqual({ uncached: 50, cached: 17, output: 33, counts: [750, 250, 500] });
    expect(tokenMix({ input: 0, cachedInput: 0, output: 0 })).toBeNull();
    expect(tokenMix({ input: 10, cachedInput: 50, output: 0 }).counts).toEqual([0, 10, 0]);
  });

  it('parses alert thresholds and rejects values outside 1–100', () => {
    expect(parseThresholds('90, 75 100,75')).toEqual([75, 90, 100]);
    expect(parseThresholds('0, 50')).toBeNull();
    expect(parseThresholds('50.5')).toBeNull();
    expect(parseThresholds('')).toBeNull();
    expect(parseThresholds('10,20,30,40,50,60')).toBeNull();
  });

  it('names the budget that stopped a run and caps usage bars at 100%', () => {
    expect(budgetScopeText({ scope: 'USER' })).toBe('your personal AI budget');
    expect(budgetScopeText({ scope: 'PROJECT' })).toBe('this project’s AI budget');
    expect(budgetScopeText(undefined)).toBe('the workspace AI budget');
    expect(budgetUse({ limit: '2', spent: '1', reserved: '5' })).toEqual({ spent: 50, reserved: 100 });
    expect(budgetUse({ limit: '0', spent: '1', reserved: '0' })).toEqual({ spent: 0, reserved: 0 });
  });

  it('summarises reconciliation imports and pre-fills price forms', () => {
    expect(importSummary([{ status: 'RECONCILED' }, { status: 'VARIANCE' }, { status: 'SKIPPED' }])).toBe('Days: 1 reconciled, 1 with a variance, 1 skipped.');
    expect(importSummary([])).toBe('No days in the file.');
    const draft = priceDraft({ provider: 'mock', currentPriceId: 'p1', prices: [{ id: 'p1', inputPerMTok: '0.40', outputPerMTok: '1.60', cachedInputPerMTok: null }] });
    expect(draft).toMatchObject({ unit: 'MTOK', inputPerMTok: '0.40', outputPerMTok: '1.60', cachedInputPerMTok: '', sourceUrl: '', isDemo: false });
    expect(priceDraft({ provider: 'local', prices: [] })).toMatchObject({ unit: 'CPU_HOUR', outputPerMTok: '' });
  });

  it('lists super-admin destinations in the palette only for super admins', () => {
    const ids = (viewer) => allCommands([], {}, viewer).map((c) => c.id);
    expect(ids({})).not.toContain('go:admin-costs');
    expect(ids({ superAdmin: true })).toEqual(expect.arrayContaining(['go:admin-costs', 'go:admin-pricing', 'go:admin-models']));
  });
});

describe('Cost Center', () => {
  it('shows budgets, local compute, breakdowns, prices and the estimator', async () => {
    const fake = installFakeFetch(createFakeApi({ anomaly: true, allModels: true }));
    renderApp('/app/costs');
    await screen.findByRole('heading', { level: 1, name: 'Your AI usage' });
    expect(await screen.findByText(/finalized of \$5\.00/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage budgets' })).toHaveAttribute('href', '/app/settings/budgets');
    expect(screen.getByRole('heading', { name: 'Local compute' })).toBeInTheDocument();
    expect(screen.getByText(/never counted as API spend or against budgets/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /By project/ })).toBeInTheDocument();
    expect(screen.getByText('Project Atlas')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'By member' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Unusual spend' })).toBeInTheDocument();
    expect(screen.getByText(/against a 14-day average of \$0\.35/)).toBeInTheDocument();
    expect(screen.getByText(/DEMO rates are illustrative/)).toBeInTheDocument();

    const est = screen.getByRole('region', { name: 'Cost estimator' });
    // 10 calls × (4500 × 0.40 + 1500 × 0.40 + 500 × 1.60) / 1M = $0.032
    expect(await within(est).findByText('$0.0320')).toBeInTheDocument();
    expect(within(est).getByText(/With/)).toHaveTextContent('mock-concise');
    expect(within(est).getByText(/With/)).toHaveTextContent('(-53%)');
    fireEvent.change(within(est).getByLabelText('Calls'), { target: { value: '20' } });
    expect(await within(est).findByText('$0.0640')).toBeInTheDocument();
    expect(fake.db.log.filter((l) => l.endsWith('/costs/estimate')).length).toBeGreaterThan(1);
  });

  it('filters the spending trend by model and range', async () => {
    const fake = installFakeFetch();
    renderApp('/app/costs');
    await screen.findByText(/AI API spend in the last 30 days · all models/);
    fireEvent.change(screen.getByLabelText('Model filter'), { target: { value: 'mock-grounded' } });
    expect(await screen.findByText(/AI API spend in the last 30 days · mock-grounded/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '7d' }));
    expect(await screen.findByText(/AI API spend in the last 7 days/)).toBeInTheDocument();
    expect(fake.db.log).toContain(`GET /workspaces/${fake.db.workspaces[0].id}/costs/summary`);
  });

  it('hides the per-member breakdown and budget management from viewers', async () => {
    const fake = createFakeApi({ role: 'VIEWER' });
    installFakeFetch(fake);
    useWorkspaceStore.setState({ workspaceId: fake.db.workspaces[1].id });
    renderApp('/app/costs');
    await screen.findByRole('heading', { level: 1, name: 'Your AI usage' });
    expect(await screen.findByText(/Workspace admins manage budgets/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'By member' })).toBeNull();
    useWorkspaceStore.setState({ workspaceId: null });
  });
});

describe('budget settings', () => {
  it('adds, edits and deletes a project budget', async () => {
    const fake = installFakeFetch();
    renderApp('/app/settings/budgets');
    const table = await screen.findByRole('table', { name: 'Budgets in this workspace' });
    expect(within(table).getByText('Workspace budget')).toBeInTheDocument();

    const form = screen.getByRole('form', { name: 'Add a budget' });
    fireEvent.click(within(form).getByRole('button', { name: 'Add budget' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Enter the limit in USD');
    fireEvent.change(within(form).getByLabelText('Limit (USD)'), { target: { value: '2.50' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add budget' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Choose the project');
    const atlas = fake.db.projects.find((p) => p.name === 'Project Atlas');
    await within(form).findByRole('option', { name: 'Project Atlas' });
    fireEvent.change(within(form).getByLabelText('Project'), { target: { value: atlas.id } });
    fireEvent.change(within(form).getByLabelText(/Alert at/), { target: { value: '50, 100' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add budget' }));
    expect(await within(table).findByText('Project Project Atlas')).toBeInTheDocument();
    expect(fake.db.costs.budgets[0]).toMatchObject({ scope: 'PROJECT', scopeRefId: atlas.id, limitAmount: '2.50', hard: true, alertThresholds: [50, 100] });

    fireEvent.click(within(table).getByRole('button', { name: 'Edit Project Project Atlas' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Project Project Atlas' });
    fireEvent.change(within(dialog).getByLabelText(/Limit \(USD\)/), { target: { value: '4' } });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fake.db.costs.budgets[0]).toMatchObject({ limitAmount: '4', hard: false }));
    expect(await within(table).findByText('Soft limit')).toBeInTheDocument();

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(within(table).getByRole('button', { name: 'Delete Project Project Atlas' }));
    await waitFor(() => expect(fake.db.costs.budgets).toHaveLength(0));
    expect(within(table).queryByRole('button', { name: 'Delete Workspace budget' })).toBeNull();
    confirm.mockRestore();
  });

  it('is read-only below the admin role', async () => {
    const fake = createFakeApi({ role: 'EDITOR' });
    installFakeFetch(fake);
    useWorkspaceStore.setState({ workspaceId: fake.db.workspaces[1].id });
    renderApp('/app/settings/budgets');
    expect(await screen.findByText(/Only workspace admins and owners can change budgets/)).toBeInTheDocument();
    await screen.findByRole('table', { name: 'Budgets in this workspace' });
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole('form', { name: 'Add a budget' })).toBeNull();
    useWorkspaceStore.setState({ workspaceId: null });
  });
});

describe('notifications', () => {
  it('lists unread notifications and marks them read', async () => {
    const fake = installFakeFetch(createFakeApi({ anomaly: true }));
    renderApp('/app');
    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    fireEvent.click(bell);
    const sheet = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(await within(sheet).findByRole('link', { name: 'Unusual AI spend' })).toHaveAttribute('href', '/app/costs');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Mark all read' }));
    expect(await within(sheet).findByText('All read')).toBeInTheDocument();
    expect(fake.db.costs.notifications[0].readAt).not.toBeNull();
    expect(await screen.findByRole('button', { name: 'Notifications', hidden: true })).toBeInTheDocument();
  });
});
