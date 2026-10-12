import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { renderApp } from '@/test/render.jsx';
import { createFakeApi, installFakeFetch } from '@/test/fakeApi.js';
import { parseSse } from '@/api/client.js';
import { compareEventIds, initialRunState, reduceRunEvent, splitCitations, visibleText } from '../runs/runState.js';
import { applyWorkspaceEvent } from '../runs/useWorkspaceEvents.js';
import { runCostRows } from '../costs/CostsPage.jsx';
import { branches, latestLeaf, pathTo, preflightEstimate } from './conversation.js';

vi.mock('./PdfViewer.jsx', () => ({
  default: ({ highlight }) => (
    <div role="region" aria-label="PDF preview">
      {highlight?.page ? <div role="img" aria-label="Cited passage" data-page={highlight.page} /> : null}
    </div>
  ),
}));

describe('parseSse', () => {
  it('parses complete events and keeps the unfinished tail', () => {
    const { events, rest } = parseSse('retry: 2000\n\n: ping\n\nid: 1-0\nevent: a\ndata: {"x":1}\n\nid: 2-0\ndata: {"x"');
    expect(events).toEqual([{ id: '1-0', event: 'a', data: '{"x":1}' }]);
    expect(rest).toBe('id: 2-0\ndata: {"x"');
  });

  it('joins multi-line data and accepts CRLF', () => {
    const { events } = parseSse('data: one\r\ndata: two\r\n\r\n');
    expect(events[0].data).toBe('one\ntwo');
  });
});

describe('run state', () => {
  const env = (id, type, data = {}) => ({ id, type, data });

  it('orders Redis and replay ids', () => {
    expect(compareEventIds('5-0', '10-0')).toBeLessThan(0);
    expect(compareEventIds('5-1', '5-0')).toBeGreaterThan(0);
    expect(compareEventIds('p-2', 'p-10')).toBeLessThan(0);
  });

  it('folds tokens, citations and the final answer, ignoring replayed ids', () => {
    let s = initialRunState();
    s = reduceRunEvent(s, env('1-0', 'run.state', { status: 'STREAMING' }));
    s = reduceRunEvent(s, env('2-0', 'token.delta', { text: 'Growth is ' }));
    s = reduceRunEvent(s, env('3-0', 'token.delta', { text: '14.2% [S1].' }));
    s = reduceRunEvent(s, env('3-0', 'token.delta', { text: '14.2% [S1].' }));
    s = reduceRunEvent(s, env('2-0', 'token.delta', { text: 'Growth is ' }));
    expect(visibleText(s)).toBe('Growth is 14.2% [S1].');
    expect(s.events.map((e) => e.type)).toEqual(['run.state']);
    s = reduceRunEvent(s, env('4-0', 'citation.validated', { marker: 'S1', state: 'VALID' }));
    s = reduceRunEvent(s, env('5-0', 'run.finished', { status: 'SUCCEEDED', outcome: 'ANSWERED', answer: 'Growth is 14.2% [S1].' }));
    expect(s).toMatchObject({ status: 'SUCCEEDED', outcome: 'ANSWERED', done: true });
    expect(s.citations.S1.state).toBe('VALID');
  });

  it('marks a cancelled failure', () => {
    const s = reduceRunEvent(initialRunState(), env('1-0', 'run.failed', { errorClass: 'CANCELLED' }));
    expect(s).toMatchObject({ status: 'CANCELLED', done: true });
  });

  it('splits citation markers out of text', () => {
    expect(splitCitations('A [S1] and [S2].')).toEqual([
      { type: 'text', text: 'A ' },
      { type: 'cite', marker: 'S1' },
      { type: 'text', text: ' and ' },
      { type: 'cite', marker: 'S2' },
      { type: 'text', text: '.' },
    ]);
  });
});

describe('conversation tree', () => {
  const m = (id, parent, role, content, at) => ({ id, parentMessageId: parent, role, content, status: 'COMPLETE', createdAt: `2026-01-01T00:00:0${at}Z` });
  const msgs = [m('u1', null, 'USER', 'First?', 1), m('a1', 'u1', 'ASSISTANT', 'A', 2), m('u2', null, 'USER', 'First again?', 3), m('a2', 'u2', 'ASSISTANT', 'B', 4)];

  it('finds branches and the latest leaf', () => {
    expect(latestLeaf(msgs)).toBe('a2');
    expect(pathTo(msgs, 'a1').map((x) => x.id)).toEqual(['u1', 'a1']);
    expect(branches(msgs).map((b) => b.label)).toEqual(['First?', 'First again?']);
  });

  it('estimates preflight cost only for priced models', () => {
    expect(preflightEstimate({ price: null }, 'q')).toBeNull();
    const e = preflightEstimate({ maxOutputTokens: 800, price: { inputPerMTok: '1', outputPerMTok: '2', isDemo: true } }, 'abcd');
    expect(e.amount).toBeCloseTo((3501 * 1 + 800 * 2) / 1e6, 12);
    expect(e.isDemo).toBe(true);
  });
});

describe('cost rows and workspace events', () => {
  it('pairs each run estimate with its final amount', () => {
    const rows = runCostRows([
      { runId: 'r1', entryType: 'FINAL', tier: 'FINALIZED', amount: '0.0006', createdAt: '2026-01-01T00:00:02Z', isDemo: true },
      { runId: 'r1', entryType: 'ESTIMATE', tier: 'PREFLIGHT_ESTIMATE', amount: '0.0027', createdAt: '2026-01-01T00:00:01Z', isDemo: true },
      { runId: 'r2', entryType: 'ESTIMATE', tier: 'PREFLIGHT_ESTIMATE', amount: '0.0020', createdAt: '2026-01-01T00:00:03Z', isDemo: false },
    ]);
    expect(rows.map((r) => r.runId)).toEqual(['r2', 'r1']);
    expect(rows[1]).toMatchObject({ estimate: '0.0027', final: 0.0006, finalTier: 'FINALIZED', isDemo: true });
    expect(rows[0].finalTier).toBeNull();
  });

  it('patches cached sources in place from ingestion events', () => {
    const qc = new QueryClient();
    const row = { id: 's1', ingestionState: 'PARSING', currentVersion: { id: 'v1', ingestionState: 'PARSING' } };
    qc.setQueryData(['sources', 'w1', 'p1'], [row, { id: 's2', ingestionState: 'READY' }]);
    qc.setQueryData(['source', 'w1', 's1'], { ...row, versions: [{ id: 'v1', ingestionState: 'PARSING' }] });
    applyWorkspaceEvent(qc, 'w1', { type: 'ingestion.stage', data: { sourceId: 's1', sourceVersionId: 'v1', state: 'INDEXING' } });
    expect(qc.getQueryData(['sources', 'w1', 'p1'])[0]).toMatchObject({ ingestionState: 'INDEXING', currentVersion: { ingestionState: 'INDEXING' } });
    expect(qc.getQueryData(['sources', 'w1', 'p1'])[1].ingestionState).toBe('READY');
    expect(qc.getQueryData(['source', 'w1', 's1']).versions[0].ingestionState).toBe('INDEXING');
  });
});

function docUrl(fake, title = 'Market Outlook 2026.pdf') {
  const s = fake.db.sources.find((x) => x.title === title);
  return `/app/knowledge/projects/${s.projectId}/documents/${s.id}`;
}

async function openDocument(opts, title) {
  const fake = installFakeFetch(createFakeApi(opts));
  const router = renderApp(docUrl(fake, title));
  await screen.findByRole('heading', { level: 1, name: title ?? 'Market Outlook 2026.pdf' });
  return { fake, router };
}

const composer = () => screen.getByLabelText('Ask a grounded question');

async function ask(question) {
  await waitFor(() => expect(composer()).not.toBeDisabled());
  fireEvent.change(composer(), { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
}

describe('document workspace', () => {
  it('shows the earlier answer and opens its citation at the cited passage', async () => {
    await openDocument();
    const chat = screen.getByRole('complementary', { name: 'Grounded conversation' });
    expect(await within(chat).findByText(/compound annual rate of 14\.2%/)).toBeInTheDocument();
    expect(within(chat).getByText('What is the base-case growth rate?', { selector: 'p' })).toBeInTheDocument();

    fireEvent.click(within(chat).getByRole('button', { name: /^Citation S1: / }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText(/annual rate of 14\.2% between 2026 and 2030\./)).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('button', { name: /Open at location/ }));
    const pdf = await screen.findByRole('region', { name: 'PDF preview' });
    expect(within(pdf).getByRole('img', { name: 'Cited passage' })).toHaveAttribute('data-page', '1');

    fireEvent.click(within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name: 'Text' }));
    const mark = await screen.findByLabelText('Cited passage', { selector: 'mark' });
    expect(mark).toHaveTextContent('annual rate of 14.2% between 2026 and 2030.');
    expect(mark.closest('article')).toHaveAttribute('aria-label', 'Page 1');
  });

  it('streams a new grounded answer with a verified citation and a receipt', async () => {
    const { fake } = await openDocument();
    await screen.findByText(/compound annual rate of 14\.2%/);
    await ask('How many organisations did the survey cover?');
    const chat = screen.getByRole('complementary', { name: 'Grounded conversation' });
    expect(await within(chat).findByText(/The survey covered 412 organisations across three regions/)).toBeInTheDocument();
    await waitFor(() => expect(within(chat).getAllByRole('button', { name: 'Citation S1: Verified quote, Exact location' })).toHaveLength(2));
    await waitFor(() => expect(within(chat).getAllByText('Run receipt')).toHaveLength(2));
    const run = fake.db.ai.runs.at(-1);
    expect(run).toMatchObject({ status: 'SUCCEEDED', outcome: 'ANSWERED' });
    expect(fake.db.log).toContain(`GET /workspaces/${run.workspaceId}/runs/${run.id}/events`);
    expect(fake.db.ai.messages.find((m) => m.aiRunId === run.id).parentMessageId).toBe(fake.db.ai.messages.at(-2).id);
  });

  it('resumes an interrupted stream without duplicating text', async () => {
    const { fake } = await openDocument({ streamCut: 9 });
    await screen.findByText(/compound annual rate of 14\.2%/);
    await ask('What are the main pricing risks?');
    const chat = screen.getByRole('complementary', { name: 'Grounded conversation' });
    await waitFor(
      () => expect(within(chat).getByText(/The main pricing risk/).closest('p')).toHaveTextContent(/^The main pricing risk is bundled office suites S1\W*\.$/),
      { timeout: 4000 },
    );
    const run = fake.db.ai.runs.at(-1);
    expect(fake.db.log.filter((l) => l.endsWith(`/runs/${run.id}/events`))).toHaveLength(2);
  });

  it('abstains when the document has no evidence, without a model call', async () => {
    const { fake } = await openDocument();
    await screen.findByText(/compound annual rate of 14\.2%/);
    await ask('What is the weather in Antarctica?');
    expect(await screen.findByText('No model was called for this answer, so it cost nothing.')).toBeInTheDocument();
    const run = fake.db.ai.runs.at(-1);
    expect(run.outcome).toBe('ABSTAINED');
    expect(fake.db.ai.costEntries.filter((e) => e.runId === run.id && e.entryType === 'FINAL')).toHaveLength(0);
  });

  it('shows an interrupted run with a retry and no charge', async () => {
    const { fake } = await openDocument();
    await screen.findByText(/compound annual rate of 14\.2%/);
    await ask('Simulate a worker crash please');
    expect(await screen.findByText(/The answer was interrupted before it finished\. Any reserved budget was released\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    const run = fake.db.ai.runs.at(-1);
    expect(run.status).toBe('INTERRUPTED');
    await waitFor(() => expect(fake.db.ai.messages.find((m) => m.aiRunId === run.id).status).toBe('FAILED'));
    expect(fake.db.ai.costEntries.filter((e) => e.runId === run.id && e.entryType === 'FINAL')).toHaveLength(0);
  });

  it('explains a budget rejection and charges nothing', async () => {
    const { fake } = await openDocument({ budgetLimit: '0.00000001', budgetHard: true });
    await screen.findByText(/compound annual rate of 14\.2%/);
    await ask('How many organisations did the survey cover?');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Budget limit reached.');
    expect(alert).toHaveTextContent('nothing was charged');
    expect(fake.db.ai.runs.at(-1).status).toBe('BUDGET_REJECTED');
  });

  it('keeps asking locked until indexing finishes', async () => {
    await openDocument({}, 'Analyst Briefing.docx');
    expect(composer()).toBeDisabled();
    expect(composer()).toHaveAttribute('placeholder', 'Asking unlocks when indexing finishes.');
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
  });

  it('shows not found for a document outside the workspace', async () => {
    installFakeFetch();
    renderApp('/app/knowledge/projects/x/documents/y');
    expect(await screen.findByRole('heading', { level: 1, name: 'Document not found' })).toBeInTheDocument();
  });
});

describe('studio, costs and home', () => {
  it('replays a recorded run in the read-only Studio', async () => {
    const fake = installFakeFetch();
    const run = fake.db.ai.runs[0];
    renderApp(`/app/studio/runs/${run.id}`);
    const graph = await screen.findByRole('group', { name: 'LangGraph workflow grounded_qa' });
    expect(within(graph).getByRole('button', { name: 'retrieve: succeeded' })).toBeInTheDocument();
    expect(within(graph).getByRole('button', { name: 'abstain: skipped' })).toBeInTheDocument();
    expect(screen.getByText(/recorded events only\. It makes no model calls/)).toBeInTheDocument();
    const timeline = screen.getByRole('region', { name: 'Execution events' });
    expect(within(timeline).getByText('run.finished')).toBeInTheDocument();
    expect(within(timeline).queryByText('token.delta')).toBeNull();

    fireEvent.click(within(graph).getByRole('button', { name: 'generate: succeeded' }));
    expect(await screen.findByRole('heading', { name: 'generate' })).toBeInTheDocument();
    expect(fake.db.log.some((l) => l.includes('/runs') && l.startsWith('POST'))).toBe(false);
  });

  it('shows the budget, spend and per-run cost states', async () => {
    installFakeFetch();
    renderApp('/app/costs');
    await screen.findByRole('heading', { level: 1, name: 'Your AI usage' });
    const table = await screen.findByRole('table', { name: /Recent AI runs/ });
    const row = within(table).getAllByRole('row')[1];
    expect(within(row).getByText('Finalized')).toBeInTheDocument();
    expect(within(row).getByText(/^DEMO \$0\.000608/)).toBeInTheDocument();
    expect(screen.getByText(/finalized of \$5\.00/)).toBeInTheDocument();
  });

  it('lists recent conversations, runs and projects on Home', async () => {
    const fake = installFakeFetch();
    renderApp('/app');
    const conversations = await screen.findByRole('region', { name: 'Continue a conversation' });
    expect(await within(conversations).findByRole('link', { name: 'What is the base-case growth rate?' })).toHaveAttribute('href', docUrl(fake));
    const runs = screen.getByRole('region', { name: 'Recent AI runs' });
    expect(await within(runs).findByRole('link', { name: 'What is the base-case growth rate?' })).toHaveAttribute('href', `/app/studio/runs/${fake.db.ai.runs[0].id}`);
    expect(await screen.findByRole('link', { name: 'Project Atlas' })).toBeInTheDocument();
  });
});
