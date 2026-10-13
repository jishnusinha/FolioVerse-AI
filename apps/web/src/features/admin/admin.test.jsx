import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '@/test/render.jsx';
import { createFakeApi, installFakeFetch } from '@/test/fakeApi.js';

const yesterday = () => new Date(Date.now() - 86400_000).toISOString().slice(0, 10);

describe('super admin', () => {
  it('answers not found to everyone else and keeps the rail and palette free of admin entries', async () => {
    const fake = installFakeFetch();
    renderApp('/app/admin/costs');
    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Super Admin' })).toBeNull();
    expect(fake.db.log.some((l) => l.includes('/admin/'))).toBe(false);
  });

  it('shows the Cost Command Center with class totals, calls and the reconciliation table', async () => {
    const fake = installFakeFetch(createFakeApi({ superAdmin: true, anomaly: true }));
    renderApp('/app/admin/costs');
    expect(await screen.findByRole('heading', { level: 1, name: 'Cost Command Center' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Super Admin' })).toHaveAttribute('href', '/app/admin/costs');
    expect(await screen.findByText('Platform total')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recent model calls' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'High-cost workflows' })).toBeInTheDocument();
    expect(screen.getAllByText('grounded_qa').length).toBeGreaterThan(0);
    expect(screen.getByText(/AI spend · Aster Research/)).toBeInTheDocument();

    const recon = screen.getByRole('region', { name: 'Reconciliation' });
    expect(await within(recon).findByText(/OpenAI Costs API not configured/)).toBeInTheDocument();
    expect(within(recon).getByRole('button', { name: 'Fetch from OpenAI' })).toBeDisabled();
    expect(within(recon).getByText(/Day still open|Waiting for report/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Recompute rollups' }));
    expect(await screen.findByText(/Rollups recomputed \(12 rows\)/)).toBeInTheDocument();
    expect(await screen.findByText(/Rollups updated/)).toBeInTheDocument();
    expect(fake.db.log).toContain('POST /admin/costs/rollup');
  });

  it('imports a provider CSV and reports each day', async () => {
    const fake = installFakeFetch(createFakeApi({ superAdmin: true }));
    renderApp('/app/admin/costs');
    const recon = await screen.findByRole('region', { name: 'Reconciliation' });
    fireEvent.change(within(recon).getByLabelText('Provider'), { target: { value: 'mock' } });
    fireEvent.change(within(recon).getByLabelText(/Cost report \(CSV\)/), { target: { value: `date,amount\n${yesterday()},0.50\n${new Date().toISOString().slice(0, 10)},1` } });
    fireEvent.click(within(recon).getByRole('button', { name: 'Import and reconcile' }));
    expect(await screen.findByText('Days: 1 with a variance, 1 skipped.')).toBeInTheDocument();
    expect(fake.db.costs.reports[0]).toMatchObject({ provider: 'mock', report: '0.50000000', status: 'VARIANCE', isDemo: true });
    expect(await within(recon).findByText('+$0.50')).toBeInTheDocument();

    fireEvent.change(within(recon).getByLabelText(/Cost report \(CSV\)/), { target: { value: 'when,total\nx,1' } });
    fireEvent.click(within(recon).getByRole('button', { name: 'Import and reconcile' }));
    expect(await screen.findByText('The CSV needs a date column and an amount column')).toBeInTheDocument();
  });

  it('records a manual cloud cost and keeps the GCP import disabled when unconfigured', async () => {
    const fake = installFakeFetch(createFakeApi({ superAdmin: true }));
    renderApp('/app/admin/costs');
    const cloud = await screen.findByRole('region', { name: 'Cloud infrastructure · 30d' });
    expect(await within(cloud).findByText(/not configured \(FV_GCP_BILLING_TABLE\)/)).toBeInTheDocument();
    expect(within(cloud).getByRole('button', { name: 'Import GCP billing export' })).toBeDisabled();
    const form = within(cloud).getByRole('form', { name: 'Record a cloud cost' });
    fireEvent.change(within(form).getByLabelText('Day'), { target: { value: yesterday() } });
    fireEvent.change(within(form).getByLabelText('Service'), { target: { value: 'Cloud Run' } });
    fireEvent.change(within(form).getByLabelText('Amount (USD)'), { target: { value: '1.25' } });
    fireEvent.click(within(form).getByRole('checkbox'));
    fireEvent.click(within(form).getByRole('button', { name: 'Record cost' }));
    expect(await within(cloud).findByText('DEMO $1.25')).toBeInTheDocument();
    expect(fake.db.costs.infra[0]).toMatchObject({ service: 'Cloud Run', amount: '1.25000000', source: 'MANUAL', isDemo: true });
  });

  it('adds a price version and explains the backdate rule', async () => {
    const fake = installFakeFetch(createFakeApi({ superAdmin: true }));
    renderApp('/app/admin/pricing');
    expect(await screen.findByRole('heading', { level: 1, name: 'Model prices' })).toBeInTheDocument();
    const history = await screen.findByRole('region', { name: /mock-grounded price history/ });
    expect(within(history).getByText('Current')).toBeInTheDocument();
    const form = within(history).getByRole('form', { name: 'Add a price version' });
    expect(within(form).getByLabelText('Input (USD / 1M)')).toHaveValue('0.40');

    fireEvent.change(within(form).getByLabelText(/Source URL/), { target: { value: 'http://example.com' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add price' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Give the https page');

    fireEvent.change(within(form).getByLabelText('Input (USD / 1M)'), { target: { value: '0.50' } });
    fireEvent.change(within(form).getByLabelText(/Effective from/), { target: { value: '2026-01-02T00:00' } });
    fireEvent.change(within(form).getByLabelText(/Source URL/), { target: { value: 'demo://folioverse/repriced' } });
    fireEvent.click(within(form).getByRole('checkbox'));
    fireEvent.click(within(form).getByRole('button', { name: 'Add price' }));
    expect(await screen.findByText(/Entries already finalized keep the price/)).toBeInTheDocument();
    const m = fake.db.costs.adminModels.find((x) => x.id === 'mock-grounded');
    await waitFor(() => expect(m.prices).toHaveLength(2));
    expect(m.prices.find((p) => p.inputPerMTok === '0.50')).toMatchObject({ isDemo: true, sourceUrl: 'demo://folioverse/repriced', unit: 'MTOK' });

    fireEvent.click(screen.getByRole('button', { name: 'local-compute' }));
    const local = await screen.findByRole('region', { name: /local-compute price history/ });
    expect(within(local).getByText(/No price yet/)).toBeInTheDocument();
    expect(within(local).getByLabelText('USD per CPU-hour')).toBeInTheDocument();
    expect(within(local).queryByLabelText('Output (USD / 1M)')).toBeNull();
  });

  it('verifies models, changes the default and shows the seed diff', async () => {
    const fake = installFakeFetch(createFakeApi({ superAdmin: true }));
    renderApp('/app/admin/models');
    const table = await screen.findByRole('table', { name: 'Model configurations' });
    const concise = within(table).getByText('mock-concise').closest('tr');
    expect(within(concise).getByText('unverified')).toBeInTheDocument();
    fireEvent.click(within(concise).getByRole('button', { name: 'Verify mock-concise' }));
    expect(await within(concise).findByText('verified')).toBeInTheDocument();
    fireEvent.click(within(concise).getByRole('button', { name: 'Make mock-concise the default' }));
    await waitFor(() => expect(fake.db.costs.adminModels.find((m) => m.id === 'mock-concise').isDefault).toBe(true));
    expect(fake.db.costs.adminModels.find((m) => m.id === 'mock-grounded').isDefault).toBe(false);
    expect(within(table).queryByRole('button', { name: 'Make local-compute the default' })).toBeNull();

    const diff = screen.getByRole('region', { name: 'Seed file vs registry' });
    expect(await within(diff).findByText('waiting for FV_OPENAI_CHAT_MODEL')).toBeInTheDocument();
    expect(within(diff).getByRole('button', { name: 'Add new seed entries' })).toBeDisabled();
  });
});
