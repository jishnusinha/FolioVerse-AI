import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { can, useCurrentWorkspace } from '@/features/auth/session.js';
import { formatInt, formatMs } from '@/shared/format.js';
import { Badge, Button, Callout, Dialog, Empty, Field, Progress, Select, Skeleton, toast } from '@/shared/ui/index.js';
import { useModels } from '../runs/queries.js';
import { NOTE_LABEL, budgetUse, checkpointLabel, diffCheckpoints, studioApi, studioKeys, useCheckpoints, xrayRows } from './queries.js';
import { tutorFor } from './tutor.js';

const SECTIONS = [
  ['runs', 'Runs', '/app/studio'],
  ['compare', 'Compare', '/app/studio/compare'],
  ['playground', 'Playground', '/app/studio/playground'],
  ['battles', 'Model Battle', '/app/studio/battles'],
  ['evaluations', 'Evaluations', '/app/studio/evaluations'],
];

/** @param {{ view: string, compact?: boolean }} props `compact` wraps the tabs for the narrow run explorer. */
export function StudioNav({ view, compact = false }) {
  return (
    <nav className="tabs" aria-label="Studio sections" style={compact ? { padding: '0 6px', flexWrap: 'wrap', rowGap: 0 } : { padding: '0 14px' }}>
      {SECTIONS.map(([id, label, to]) => (
        <Link key={id} to={to} aria-current={view === id ? 'page' : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** Page frame for the Studio tools (everything except the run explorer). */
export function StudioFrame({ view, eyebrow, title, intro, children }) {
  return (
    <div className="page studio">
      <p className="eyebrow">{eyebrow}</p>
      <h1 style={{ fontSize: 22, margin: '4px 0 12px' }}>{title}</h1>
      <StudioNav view={view} />
      {intro && (
        <p className="callout" style={{ margin: '16px 0' }}>
          {intro}
        </p>
      )}
      {children}
    </div>
  );
}

const fmtRank = (r) => (r == null ? '—' : r);

/** Retrieval internals of one recorded retrieval: ranks per retriever, fusion, rerank movement and packing. */
export function XRay({ retrieval }) {
  const rows = useMemo(() => xrayRows(retrieval), [retrieval]);
  if (!retrieval) return <Empty>This run did not retrieve anything, so there is nothing to X-ray.</Empty>;
  const budget = budgetUse(retrieval);
  const p = retrieval.params ?? {};
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        {p.mode === 'frozen' ? <Badge tone="ai">Frozen context (battle)</Badge> : <Badge>fusion: {p.fusion ?? 'rrf'}</Badge>}
        {p.topK != null && <Badge>top-K {p.topK}</Badge>}
        {p.rerank != null && <Badge tone={p.rerank ? 'ok' : 'neutral'}>rerank {p.rerank ? 'on' : 'off'}</Badge>}
        {p.chunkLevel && <Badge>chunks: {p.chunkLevel}</Badge>}
        {p.embedder && <Badge>{p.embedder}</Badge>}
        <span className="subtle mono" style={{ fontSize: 12 }}>
          {rows.length} candidates · {(retrieval.packed ?? []).length} packed · {formatMs(retrieval.latencyMs)}
        </span>
      </div>
      {budget.budget != null && (
        <div>
          <div className="row between" style={{ fontSize: 12 }}>
            <span>Context budget</span>
            <span className="mono">
              {formatInt(budget.used)} / {formatInt(budget.budget)} tokens
            </span>
          </div>
          <Progress value={budget.pct} label="Context budget used" />
        </div>
      )}
      <div style={{ overflow: 'auto' }}>
        <table className="table" aria-label="Retrieval candidates">
          <thead>
            <tr>
              <th scope="col" className="num">
                Final
              </th>
              <th scope="col">Passage</th>
              <th scope="col" className="num">
                Dense
              </th>
              <th scope="col" className="num">
                BM25
              </th>
              <th scope="col" className="num">
                Fused
              </th>
              <th scope="col" className="num">
                Rerank Δ
              </th>
              <th scope="col">Packer</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.chunkId} className={r.marker ? 'sel' : undefined}>
                <td className="num mono">{r.finalRank}</td>
                <td>
                  <span className="mono">{r.marker ? `[${r.marker}] ` : ''}</span>
                  {r.title ?? 'Passage'}
                  {r.page != null && <span className="subtle"> · p.{r.page}</span>}
                </td>
                <td className="num mono">{fmtRank(r.denseRank)}</td>
                <td className="num mono">{fmtRank(r.sparseRank)}</td>
                <td className="num mono">{fmtRank(r.fusedRank)}</td>
                <td className="num mono" aria-label={r.delta == null ? 'no change' : r.delta > 0 ? `up ${r.delta}` : r.delta < 0 ? `down ${-r.delta}` : 'no change'}>
                  {r.delta == null || r.delta === 0 ? '·' : r.delta > 0 ? `▲${r.delta}` : `▼${-r.delta}`}
                </td>
                <td style={{ fontSize: 12 }}>
                  {NOTE_LABEL[r.note] ?? r.note}
                  {r.tokens != null && <span className="subtle mono"> · {r.tokens} tok</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="subtle" style={{ fontSize: 11.5 }}>
        Ranks are 1-based; a dash means that retriever did not return the passage. Passage text is not stored in traces.
      </p>
    </div>
  );
}

const show = (v) => (v === undefined ? '—' : JSON.stringify(v));

/** Checkpoint list with state diffs and fork-from-here. */
export function TimeMachine({ wid, run, onFork }) {
  const cps = useCheckpoints(wid, run.id);
  const list = useMemo(() => cps.data?.checkpoints ?? [], [cps.data]);
  const [sel, setSel] = useState(/** @type {number | null} */ (null));
  const i = sel ?? list.length - 1;
  const cur = list[i];
  const diff = useMemo(() => (cur ? diffCheckpoints(list[i - 1], cur).filter((d) => d.change !== 'same') : []), [list, i, cur]);
  if (cps.isPending) return <Skeleton height={120} />;
  if (cps.error) return <Callout>Checkpoints are unavailable because the AI service is not reachable.</Callout>;
  if (!list.length) return <Empty>No checkpoints were saved for this run.</Empty>;
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
      <ol className="stack" aria-label="Checkpoints" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 4, minWidth: 200 }}>
        {list.map((c, n) => (
          <li key={c.checkpointId}>
            <button type="button" className="chipbtn" aria-pressed={n === i} onClick={() => setSel(n)} style={{ width: '100%', textAlign: 'left' }}>
              <span className="mono">#{c.step ?? n}</span> {checkpointLabel(c)}
            </button>
          </li>
        ))}
      </ol>
      <section className="grow stack" style={{ gap: 10 }} aria-label="Checkpoint state">
        <div className="row between">
          <b>
            Step {cur.step} · {checkpointLabel(cur)}
          </b>
          <Button size="sm" onClick={() => onFork(cur)} disabled={!cur.next?.length}>
            Fork from here…
          </Button>
        </div>
        <table className="table" aria-label="State changes at this checkpoint">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Before</th>
              <th scope="col">After</th>
            </tr>
          </thead>
          <tbody>
            {diff.length ? (
              diff.map((d) => (
                <tr key={d.key}>
                  <th scope="row" className="mono">
                    {d.key} {d.change === 'added' ? <Badge tone="ok">new</Badge> : d.change === 'removed' ? <Badge tone="bad">removed</Badge> : null}
                  </th>
                  <td className="mono subtle">{show(d.before)}</td>
                  <td className="mono">{show(d.after)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className="subtle">
                  No state change at this step.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="subtle" style={{ fontSize: 11.5 }}>
          State values are redacted summaries (lengths and counts). Forking re-runs the graph from this checkpoint as a new lab run, billed separately.
        </p>
      </section>
    </div>
  );
}

/** Fork a run (optionally from a checkpoint) into a new, separately billed lab run. */
export function ForkDialog({ wid, run, checkpoint, open, onOpenChange }) {
  const ws = useCurrentWorkspace();
  const models = useModels();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const chat = (models.data ?? []).filter((m) => m.available !== false && (m.capabilities ?? ['chat']).includes('chat'));
  const [model, setModel] = useState('');
  const [question, setQuestion] = useState(run.input?.question ?? '');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const body = {
        ...(checkpoint ? { checkpointId: checkpoint.checkpointId } : {}),
        ...(model ? { modelPreference: model } : {}),
        ...(run.input?.question != null && question.trim() && question.trim() !== run.input.question ? { inputOverride: { question: question.trim() } } : {}),
      };
      const res = await studioApi.fork(wid, run.id, body);
      await qc.invalidateQueries({ queryKey: ['runs', wid] });
      toast(res.status === 'BUDGET_REJECTED' ? 'Fork rejected by the budget' : 'Fork started as a lab run', res.status === 'BUDGET_REJECTED' ? 'bad' : 'ok');
      onOpenChange(false);
      navigate(`/app/studio/runs/${res.runId}`);
    } catch (e) {
      toast(e.message || 'The fork could not be started', 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={checkpoint ? `Fork from step ${checkpoint.step}` : 'Re-run as a fork'}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !can(ws, 'EDITOR')}>
            {busy ? 'Starting…' : 'Start fork'}
          </Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 12 }}>
        <Callout tone="warn">This creates a new lab run that calls the model again and is billed separately. Replaying the recorded trace is free.</Callout>
        {run.input?.question != null && (
          <Field label="Question">
            <textarea className="input" rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} />
          </Field>
        )}
        <Field label="Model" hint="Leave on the original to isolate other changes.">
          <Select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">Same as the original run</option>
            {chat.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
                {m.isDemo ? ' (DEMO)' : ''}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

/** How this graph works, what its tier means, why it cost what it did, and what to try next. */
export function TutorPanel({ run, receipt }) {
  const t = tutorFor(run, receipt);
  const executed = new Set((receipt?.nodes ?? []).map((n) => n.node));
  return (
    <div className="stack" style={{ gap: 14, maxWidth: '72ch' }} aria-label="Agent Tutor">
      <section>
        <h3 className="sect-h">How {run.graph} works</h3>
        <p>{t.graph}</p>
      </section>
      {t.tier && (
        <section>
          <h3 className="sect-h">Tier {t.tier.label}</h3>
          <p>{t.tier.text}</p>
        </section>
      )}
      {executed.size > 0 && (
        <section>
          <h3 className="sect-h">Nodes in this run</h3>
          <dl className="kv">
            {[...executed].map((n) => (
              <div key={n} style={{ display: 'contents' }}>
                <dt className="mono">{n}</dt>
                <dd>{t.nodes[n] ?? 'A step of this graph.'}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <section>
        <h3 className="sect-h">Where the cost comes from</h3>
        <p>{t.cost}</p>
        {t.demo && <p className="subtle">{t.demo}</p>}
      </section>
      <section>
        <h3 className="sect-h">Try next</h3>
        <ul>
          {t.next.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export { studioKeys };
