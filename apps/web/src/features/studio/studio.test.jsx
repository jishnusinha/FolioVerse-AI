import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '@/test/render.jsx';
import { createFakeApi, installFakeFetch } from '@/test/fakeApi.js';
import { budgetUse, diffCheckpoints, qualityScore, replayFrame, scatterPoints, xrayRows } from './queries.js';
import { tutorFor } from './tutor.js';

describe('studio helpers', () => {
  it('diffs checkpoint state summaries', () => {
    const rows = diffCheckpoints({ state: { question: '<10 chars>', packed: '<0 items>' } }, { state: { question: '<10 chars>', packed: '<3 items>', topScore: 0.8 } });
    expect(rows).toEqual([
      { key: 'packed', before: '<0 items>', after: '<3 items>', change: 'changed' },
      { key: 'question', before: '<10 chars>', after: '<10 chars>', change: 'same' },
      { key: 'topScore', before: undefined, after: 0.8, change: 'added' },
    ]);
  });

  it('replays recorded node events frame by frame', () => {
    const events = [
      { type: 'run.state', data: { status: 'RUNNING' } },
      { type: 'node.started', data: { node: 'retrieve', step: 1 } },
      { type: 'node.finished', data: { node: 'retrieve', step: 1, status: 'SUCCEEDED', durationMs: 40 } },
      { type: 'node.started', data: { node: 'generate', step: 2 } },
    ];
    expect(replayFrame(events, 1)).toEqual({ retrieve: { status: 'RUNNING', step: 1 } });
    expect(replayFrame(events, 3)).toEqual({ retrieve: { status: 'SUCCEEDED', step: 1, durationMs: 40 }, generate: { status: 'RUNNING', step: 2 } });
  });

  it('builds X-Ray rows with rerank movement, packer notes and budget use', () => {
    const retrieval = {
      params: { budget: 1000 },
      candidates: [
        { chunkId: 'a', fusedRank: 2, finalRank: 1, note: 'packed-parent' },
        { chunkId: 'b', fusedRank: 1, finalRank: 2, note: 'over-budget' },
      ],
      packed: [{ chunkId: 'a', marker: 'S1', level: 'PARENT', tokens: 400 }],
    };
    const rows = xrayRows(retrieval);
    expect(rows.map((r) => [r.chunkId, r.delta, r.marker, r.note])).toEqual([
      ['a', 1, 'S1', 'packed-parent'],
      ['b', -1, null, 'over-budget'],
    ]);
    expect(budgetUse(retrieval)).toEqual({ used: 400, budget: 1000, pct: 40 });
  });

  it('scores quality and plots finished evaluations only', () => {
    expect(qualityScore({ faithfulness: 1, retrievalRecall: 0.5, answerAccuracy: null, abstentionAccuracy: 0.75 })).toBe(0.75);
    const pts = scatterPoints(
      [
        { id: 'e1', status: 'SUCCEEDED', modelConfigId: 'm', isDemo: true, metrics: { costPerAnswer: '0.00010000', faithfulness: 1 } },
        { id: 'e2', status: 'RUNNING', modelConfigId: 'm', metrics: null },
      ],
      [{ id: 'm', displayName: 'Model M' }],
    );
    expect(pts).toEqual([{ id: 'e1', model: 'Model M', cost: 0.0001, quality: 1, isDemo: true }]);
  });

  it('explains tiers, costs and next steps', () => {
    const t = tutorFor({ graph: 'grounded_qa', tier: 'T1', status: 'SUCCEEDED', outcome: 'ABSTAINED' }, { modelCalls: [], cost: { isDemo: true } });
    expect(t.tier.label).toMatch(/T1/);
    expect(t.cost).toMatch(/costs nothing/);
    expect(t.next[0]).toMatch(/abstained/);
  });
});

describe('Studio run view', () => {
  it('shows RAG X-Ray, the time machine and the tutor, and forks from a checkpoint into a lab run', async () => {
    const fake = installFakeFetch(createFakeApi());
    const seeded = fake.ai.ai.runs[0];
    const router = renderApp(`/app/studio/runs/${seeded.id}`);
    await screen.findByRole('group', { name: /LangGraph workflow grounded_qa/ });

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'RAG X-Ray' }));
    const table = await screen.findByRole('table', { name: 'Retrieval candidates' });
    expect(within(table).getAllByRole('row')).toHaveLength(9);
    expect(within(table).getAllByText('Packed (parent section)')).toHaveLength(2);
    expect(within(table).getAllByText('Dropped: over context budget')).toHaveLength(2);
    expect(within(table).getByLabelText('up 1')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Context budget used' })).toHaveAttribute('aria-valuenow', '27');

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Tutor' }));
    expect(await screen.findByRole('heading', { name: /Tier T1/ })).toBeInTheDocument();
    expect(screen.getByText(/Prices here are DEMO values/)).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Time machine' }));
    const cps = await screen.findByRole('list', { name: 'Checkpoints' });
    fireEvent.click(within(cps).getByRole('button', { name: /#1 before generate/ }));
    const diff = screen.getByRole('table', { name: 'State changes at this checkpoint' });
    expect(within(diff).getByRole('rowheader', { name: /packed/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fork from here…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fork from step 1' });
    expect(within(dialog).getByText(/billed separately/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start fork' }));

    await waitFor(() => expect(router.state.location.pathname).not.toBe(`/app/studio/runs/${seeded.id}`));
    const fork = fake.ai.ai.runs.at(-1);
    expect(fork).toMatchObject({ lab: true, threadId: null, parentRunId: seeded.id, forkedFromCheckpoint: `${seeded.id}-cp-1` });
    expect(await screen.findByRole('link', { name: 'Compare with parent' })).toHaveAttribute('href', `/app/studio/compare?runs=${seeded.id},${fork.id}`);
  });

  it('replays the recorded trace without creating a run', async () => {
    const fake = installFakeFetch(createFakeApi());
    const before = fake.ai.ai.runs.length;
    renderApp(`/app/studio/runs/${fake.ai.ai.runs[0].id}`);
    await screen.findByRole('group', { name: /LangGraph workflow/ });
    fireEvent.click(screen.getByRole('button', { name: 'Replay (free)' }));
    expect(await screen.findByRole('button', { name: /Replaying 0\/8/ })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('button', { name: /Replaying 1\/8/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Replaying/ }));
    expect(screen.getByRole('button', { name: 'Replay (free)' })).toBeInTheDocument();
    expect(fake.ai.ai.runs).toHaveLength(before);
  });

  it('redirects the old evaluations view', async () => {
    installFakeFetch(createFakeApi());
    const router = renderApp('/app/studio?view=evaluations');
    await screen.findByRole('heading', { level: 1, name: 'Evaluations' });
    expect(router.state.location.pathname).toBe('/app/studio/evaluations');
  });
});

describe('Studio tools', () => {
  it('runs the Retrieval Playground as a detached lab run, including an injected failure', async () => {
    const fake = installFakeFetch(createFakeApi());
    const threads = fake.ai.ai.threads.length;
    renderApp('/app/studio/playground');
    await screen.findByRole('heading', { level: 1, name: 'Retrieval Playground' });
    const form = screen.getByRole('form', { name: 'Playground settings' });
    await within(form).findAllByRole('option', { name: /Mock concise model/ });
    fireEvent.change(within(form).getByLabelText('Question'), { target: { value: 'What is the main pricing risk?' } });
    fireEvent.change(within(form).getByLabelText('Top-K'), { target: { value: '5' } });
    fireEvent.change(within(form).getByLabelText('Model'), { target: { value: 'mock-concise' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Run in the lab' }));

    const answer = await screen.findByRole('article', { name: 'Lab answer' });
    expect(await within(answer).findByText('Bundled office suites')).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: 'Retrieval candidates' })).toBeInTheDocument();
    const run = fake.ai.ai.runs.at(-1);
    expect(run).toMatchObject({ lab: true, threadId: null, options: expect.objectContaining({ topK: 5, fusion: 'rrf', chunkLevel: 'auto' }) });
    expect(run.modelPlan.primary.modelConfigId).toBe('mock-concise');
    expect(fake.ai.ai.threads).toHaveLength(threads);

    fireEvent.change(within(form).getByLabelText(/^Failure injection/), { target: { value: 'retrieval_down' } });
    expect(within(form).getByText(/Retrieval fails before any model call/)).toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button', { name: 'Run in the lab' }));
    expect(await screen.findByText('injected: retrieval_down')).toBeInTheDocument();
    expect(await screen.findByText(/vector store is unavailable/)).toBeInTheDocument();
  });

  it('disables failure injection when the server turns it off', async () => {
    installFakeFetch(createFakeApi({ labFaults: false }));
    renderApp('/app/studio/playground');
    const form = await screen.findByRole('form', { name: 'Playground settings' });
    await within(form).findByText(/FV_LAB_FAULTS is off/);
    expect(within(form).getByLabelText(/^Failure injection/)).toBeDisabled();
  });

  it('compares two runs side by side', async () => {
    const fake = installFakeFetch(createFakeApi());
    const a = fake.ai.ai.runs[0];
    const res = fake.ai.createRun(a.workspaceId, { graph: 'grounded_qa', input: { question: a.input.question }, scope: a.scope, modelPreference: 'mock-concise', lab: true, detached: true });
    const b = fake.ai.ai.runs.find((r) => r.id === res.body.runId);
    fake.ai.complete(b);
    renderApp(`/app/studio/compare?runs=${a.id},${b.id}`);
    const colA = await screen.findByRole('article', { name: `Run ${a.id}` });
    const colB = screen.getByRole('article', { name: `Run ${b.id}` });
    expect(within(colA).getByText('mock-grounded')).toBeInTheDocument();
    expect(within(colB).getByText('folioverse-mock-concise')).toBeInTheDocument();
    expect(within(colB).getByText('LAB')).toBeInTheDocument();
    expect(within(colB).getByText('14.2% a year from 2026 to 2030')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(2);
  });

  it('runs a blind Model Battle and reveals models and cost per answer after the vote', async () => {
    const fake = installFakeFetch(createFakeApi());
    const router = renderApp('/app/studio/battles');
    const form = await screen.findByRole('form', { name: 'New battle' });
    fireEvent.click(await within(form).findByRole('checkbox', { name: /Mock grounded model/ }));
    fireEvent.click(within(form).getByRole('checkbox', { name: /Mock concise model/ }));
    fireEvent.click(within(form).getByRole('button', { name: /Start battle \(2 runs, billed\)/ }));

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/app\/studio\/battles\/.+/));
    const a = await screen.findByRole('article', { name: 'Answer A' });
    screen.getByRole('article', { name: 'Answer B' });
    expect(within(a).queryByText('Cost per answer')).toBeNull();
    expect(screen.queryByText(/Mock concise model/)).toBeNull();
    expect(screen.getByText(/Frozen context: \[S1\]/)).toBeInTheDocument();
    for (const id of fake.studio.studio.battles[0].contestants.map((c) => c.runId)) {
      expect(fake.ai.ai.runs.find((r) => r.id === id)).toMatchObject({ lab: true, threadId: null });
    }

    fireEvent.click(await screen.findByRole('button', { name: 'A is better' }));
    expect(await within(a).findByText('Winner')).toBeInTheDocument();
    expect(within(a).getByText('Cost per answer')).toBeInTheDocument();
    expect(screen.getAllByRole('definition').some((d) => /Mock concise model/.test(d.textContent))).toBe(true);
    expect(screen.queryByRole('button', { name: 'A is better' })).toBeNull();
  });

  it('runs a RAG evaluation and plots it on the cost-vs-quality chart', async () => {
    installFakeFetch(createFakeApi());
    renderApp('/app/studio/evaluations');
    const form = await screen.findByRole('form', { name: 'Run a RAG evaluation' });
    await within(form).findByText(/Market outlook Q&A/);
    fireEvent.click(within(form).getByRole('checkbox', { name: /judge model/ }));
    expect(within(form).getByText(/DEMO mock judge/)).toBeInTheDocument();
    const run = await within(form).findByRole('button', { name: 'Run 4 questions' });
    await waitFor(() => expect(run).toBeEnabled());
    fireEvent.click(run);

    const list = await screen.findByRole('table', { name: 'RAG evaluations' });
    expect(within(list).getAllByText('100.0%').length).toBeGreaterThanOrEqual(4);
    expect(within(list).getByText('4.00 / 5')).toBeInTheDocument();
    const items = await screen.findByRole('table', { name: 'Per-question results' });
    expect(within(items).getAllByRole('row')).toHaveLength(5);
    expect(within(items).getByText('✓ abstained')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Cost versus quality for 1 evaluation runs' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Offline evaluation' })).toBeInTheDocument();
  });

  it('lists the research notebooks with their committed findings', async () => {
    installFakeFetch(createFakeApi());
    renderApp('/app/studio/evaluations');
    const list = await screen.findByRole('list', { name: 'Research notebooks' });
    expect(list.querySelectorAll(':scope > li')).toHaveLength(11);
    expect(await within(list).findByText(/the constant is not critical/)).toBeInTheDocument();
    expect(within(list).getAllByText('No committed results on this server.')).toHaveLength(10);
    expect(within(list).getByText('ml-notebooks/03_hybrid_retrieval_rrf.ipynb')).toBeInTheDocument();
    expect(within(list).getByText('datasets/evaluation/results/nb-03-hybrid-retrieval-rrf.json')).toBeInTheDocument();
  });
});
