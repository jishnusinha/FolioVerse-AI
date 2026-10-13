import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { can, useCurrentWorkspace } from '@/features/auth/session.js';
import { useProjects, useSources } from '@/features/knowledge/queries.js';
import { formatInt, formatUsd } from '@/shared/format.js';
import { Badge, Button, Callout, DemoBadge, Empty, Field, Input, Select, Skeleton, StatusBadge, toast } from '@/shared/ui/index.js';
import { CitedText } from '../runs/CitedText.jsx';
import { useReceipt, useTrace } from '../runs/queries.js';
import { TERMINAL_RUN } from '../runs/runState.js';
import { useRunEvents } from '../runs/useRunEvents.js';
import { StudioFrame, XRay } from './parts.jsx';
import { studioApi, useCapabilities } from './queries.js';

const READY = new Set(['READY', 'PARTIAL']);
const DEFAULTS = { topK: 8, fusion: 'rrf', rerank: true, chunkLevel: 'auto', contextBudget: 3500 };

/** Retrieval Playground: one grounded question with explicit retrieval settings, run as a detached LAB run. */
export function PlaygroundPage() {
  const ws = useCurrentWorkspace();
  const wid = ws?.id;
  const caps = useCapabilities(wid);
  const projects = useProjects(wid);
  const knowledge = (projects.data ?? []).filter((p) => p.kind === 'KNOWLEDGE' && !p.deletedAt);
  const [projectId, setProjectId] = useState('');
  const pid = projectId || knowledge[0]?.id;
  const sources = useSources(wid, pid);
  const ready = (sources.data ?? []).filter((s) => READY.has(s.ingestionState));
  const [picked, setPicked] = useState(/** @type {string[]} */ ([]));
  const [question, setQuestion] = useState('');
  const [opts, setOpts] = useState(DEFAULTS);
  const [model, setModel] = useState('');
  const [fallback, setFallback] = useState('');
  const [inject, setInject] = useState('');
  const [runId, setRunId] = useState(/** @type {string | null} */ (null));
  const [busy, setBusy] = useState(false);

  useEffect(() => setPicked([]), [pid]);
  const scope = picked.length ? picked : ready.map((s) => s.id);
  const set = (k) => (e) => setOpts((o) => ({ ...o, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Number(e.target.value) : e.target.value }));
  const models = caps.data?.models ?? [];

  const run = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await studioApi.labRun(wid, {
        graph: 'grounded_qa',
        input: { question: question.trim() },
        scope: { sourceIds: scope },
        ...(model ? { modelPreference: model } : {}),
        ...(fallback ? { fallbackModels: [fallback] } : {}),
        options: { ...opts, ...(inject ? { inject } : {}) },
      });
      setRunId(res.runId);
      if (res.status === 'BUDGET_REJECTED') toast('The budget rejected this run before any model call', 'bad');
    } catch (err) {
      toast(err.message || 'The run could not be started', 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <StudioFrame
      view="playground"
      eyebrow={`Playground · ${ws?.name ?? ''}`}
      title="Retrieval Playground"
      intro="Ask one question with explicit retrieval settings. Each run is a LAB run: it is billed like any other run, appears in the Studio run list, and never touches your conversations."
    >
      <div className="dash">
        <form className="card pad c-4 stack" style={{ gap: 12 }} onSubmit={run} aria-label="Playground settings">
          <Field label="Project">
            <Select value={pid ?? ''} onChange={(e) => setProjectId(e.target.value)}>
              {knowledge.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <fieldset className="stack" style={{ gap: 4, border: 0, padding: 0, margin: 0 }}>
            <legend className="eyebrow">Sources in scope</legend>
            {sources.isPending ? (
              <Skeleton height={40} />
            ) : !ready.length ? (
              <span className="subtle">No ready documents in this project.</span>
            ) : (
              ready.map((s) => (
                <label key={s.id} className="row" style={{ gap: 6 }}>
                  <input type="checkbox" checked={picked.includes(s.id)} onChange={() => setPicked((x) => (x.includes(s.id) ? x.filter((y) => y !== s.id) : [...x, s.id]))} />
                  {s.title}
                </label>
              ))
            )}
            <span className="subtle" style={{ fontSize: 11.5 }}>
              {picked.length ? `${picked.length} selected` : 'None selected: all ready documents are searched.'}
            </span>
          </fieldset>
          <Field label="Question">
            <textarea className="input" rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} required maxLength={2000} />
          </Field>
          <div className="row" style={{ gap: 10 }}>
            <Field label="Top-K">
              <Input type="number" min={1} max={20} value={opts.topK} onChange={set('topK')} style={{ width: 80 }} />
            </Field>
            <Field label="Fusion">
              <Select value={opts.fusion} onChange={set('fusion')}>
                <option value="rrf">Hybrid (RRF)</option>
                <option value="dense">Dense only</option>
                <option value="sparse">BM25 only</option>
              </Select>
            </Field>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <Field label="Chunk level">
              <Select value={opts.chunkLevel} onChange={set('chunkLevel')}>
                <option value="auto">Parent sections</option>
                <option value="child">Child chunks only</option>
              </Select>
            </Field>
            <Field label="Context budget (tokens)">
              <Input type="number" min={500} max={12000} step={250} value={opts.contextBudget} onChange={set('contextBudget')} style={{ width: 110 }} />
            </Field>
          </div>
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={opts.rerank} onChange={set('rerank')} /> Rerank candidates
          </label>
          <Field label="Model">
            <Select value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">Workspace default</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                  {m.isDemo ? ' (DEMO)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fallback model" hint="Tried if the first model call fails with a provider error.">
            <Select value={fallback} onChange={(e) => setFallback(e.target.value)}>
              <option value="">Registry default</option>
              {models
                .filter((m) => m.id !== model)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
            </Select>
          </Field>
          <Field
            label="Failure injection"
            hint={caps.data?.labFaults ? caps.data.faults.find((f) => f.id === inject)?.effect ?? 'Simulate a failure to see how the graph recovers.' : 'Disabled on this server (FV_LAB_FAULTS is off).'}
          >
            <Select value={inject} onChange={(e) => setInject(e.target.value)} disabled={!caps.data?.labFaults}>
              <option value="">None</option>
              {(caps.data?.faults ?? []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="primary" disabled={busy || !question.trim() || !scope.length || !can(ws, 'EDITOR')}>
            {busy ? 'Starting…' : 'Run in the lab'}
          </Button>
        </form>
        <section className="c-8 stack" style={{ gap: 12 }} aria-label="Playground result">
          {runId ? <PlaygroundResult wid={wid} runId={runId} /> : <Empty>Results appear here: the answer, its citations, cost and a RAG X-Ray of what retrieval did.</Empty>}
        </section>
      </div>
    </StudioFrame>
  );
}

function PlaygroundResult({ wid, runId }) {
  const trace = useTrace(wid, runId);
  const run = trace.data?.run;
  const active = Boolean(run && !TERMINAL_RUN.has(run.status));
  const live = useRunEvents(wid, runId, { enabled: active, onFinished: () => trace.refetch() });
  const receipt = useReceipt(wid, runId, Boolean(run) && !active);
  if (trace.isPending) return <Skeleton height={160} />;
  if (!run) return <Callout tone="bad">The run could not be loaded.</Callout>;
  const status = active && live.status !== 'QUEUED' ? live.status : run.status;
  const answer = active ? live.text : run.result?.answer ?? '';
  const citations = active ? live.citations : Object.fromEntries((run.result?.citations ?? []).map((c) => [c.marker, c]));
  const cost = receipt.data?.cost;
  return (
    <>
      <article className="card pad stack" style={{ gap: 10 }} aria-label="Lab answer">
        <div className="row">
          <StatusBadge family="run" value={status} />
          {run.outcome && <StatusBadge family="outcome" value={run.outcome} />}
          <Badge tone="ai">LAB</Badge>
          {run.isDemo && <DemoBadge />}
          {run.options?.inject && <Badge tone="warn">injected: {run.options.inject}</Badge>}
          <span className="grow" />
          <Link to={`/app/studio/runs/${run.id}`} className="btn sm ghost">
            Open in Studio
          </Link>
        </div>
        {answer ? <CitedText text={answer} citations={citations} /> : !active && <p className="subtle">No answer was produced.</p>}
        {run.error && <Callout tone="bad">{run.error.message ?? run.error.errorClass ?? 'The run failed.'}</Callout>}
        {cost && (
          <p className="subtle mono" style={{ fontSize: 12 }}>
            {formatUsd(cost.total)} · {cost.tier} · {formatInt(receipt.data.tokens.input)} in / {formatInt(receipt.data.tokens.output)} out · {receipt.data.modelCalls.length} model call
            {receipt.data.modelCalls.length === 1 ? '' : 's'}
          </p>
        )}
      </article>
      <section className="card pad" aria-labelledby="pg-xray">
        <h2 className="sect-h" id="pg-xray">
          RAG X-Ray
        </h2>
        {active && !trace.data?.retrieval?.length ? <Skeleton height={80} /> : <XRay retrieval={trace.data?.retrieval?.[0] ?? null} />}
      </section>
    </>
  );
}
