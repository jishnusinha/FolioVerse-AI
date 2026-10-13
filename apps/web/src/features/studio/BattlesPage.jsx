import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { can, useCurrentWorkspace } from '@/features/auth/session.js';
import { formatInt, formatMs, formatUsd } from '@/shared/format.js';
import { Badge, Button, Callout, DemoBadge, Empty, Field, Select, Skeleton, StatusBadge, toast } from '@/shared/ui/index.js';
import { CitedText } from '../runs/CitedText.jsx';
import { useRuns } from '../runs/queries.js';
import { StudioFrame } from './parts.jsx';
import { studioApi, studioKeys, useBattle, useBattles, useCapabilities } from './queries.js';

const INTRO =
  'Model Battle freezes the passages one grounded answer retrieved and asks two to four models the same question over exactly that context. Answers are shown blind as A, B…; models and costs are revealed after you vote. Each contestant is a separately billed LAB run.';

export function BattlesPage() {
  const ws = useCurrentWorkspace();
  const wid = ws?.id;
  const battles = useBattles(wid);
  const caps = useCapabilities(wid);
  const name = new Map((caps.data?.models ?? []).map((m) => [m.id, m.displayName]));
  return (
    <StudioFrame view="battles" eyebrow={`Model Battle · ${ws?.name ?? ''}`} title="Model Battle" intro={INTRO}>
      <div className="dash">
        <NewBattle wid={wid} ws={ws} models={caps.data?.models ?? []} />
        <section className="card pad c-7" aria-labelledby="battle-list">
          <h2 className="sect-h" id="battle-list">
            Past battles
          </h2>
          {battles.isPending ? (
            <Skeleton height={80} />
          ) : !battles.data?.length ? (
            <Empty>No battles yet.</Empty>
          ) : (
            <table className="table" aria-label="Battles">
              <thead>
                <tr>
                  <th scope="col">Question</th>
                  <th scope="col" className="num">
                    Models
                  </th>
                  <th scope="col">Winner</th>
                </tr>
              </thead>
              <tbody>
                {battles.data.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link to={`/app/studio/battles/${b.id}`}>{b.question}</Link>
                    </td>
                    <td className="num mono">{b.contestants}</td>
                    <td>{b.winner ? (b.winner === 'TIE' ? 'Tie' : `${b.winner} · ${name.get(b.winnerModel) ?? b.winnerModel}`) : <span className="subtle">Not voted</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </StudioFrame>
  );
}

function NewBattle({ wid, ws, models }) {
  const runs = useRuns(wid, { graph: 'grounded_qa', limit: 50 });
  const sources = (runs.data ?? []).filter((r) => r.outcome === 'ANSWERED');
  const [runId, setRunId] = useState('');
  const [picked, setPicked] = useState(/** @type {string[]} */ ([]));
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const source = runId || sources[0]?.id || '';
  const toggle = (id) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id].slice(-4)));
  const start = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const b = await studioApi.createBattle(wid, { runId: source, models: picked });
      await qc.invalidateQueries({ queryKey: studioKeys.battles(wid) });
      navigate(`/app/studio/battles/${b.id}`);
    } catch (err) {
      toast(err.message || 'The battle could not be started', 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card pad c-5 stack" style={{ gap: 12 }} onSubmit={start} aria-labelledby="battle-new">
      <h2 className="sect-h" id="battle-new">
        New battle
      </h2>
      {runs.isPending ? (
        <Skeleton height={40} />
      ) : !sources.length ? (
        <Empty>Ask a question about a document first; a battle reuses the passages an answered question retrieved.</Empty>
      ) : (
        <Field label="Answered question to reuse">
          <Select value={source} onChange={(e) => setRunId(e.target.value)}>
            {sources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.input?.question} ({r.id.slice(0, 8)}
                {r.lab ? ', lab' : ''})
              </option>
            ))}
          </Select>
        </Field>
      )}
      <fieldset className="stack" style={{ gap: 4, border: 0, padding: 0, margin: 0 }}>
        <legend className="eyebrow">Models (2–4)</legend>
        {models.map((m) => (
          <label key={m.id} className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={picked.includes(m.id)} onChange={() => toggle(m.id)} />
            {m.displayName} {m.isDemo && <DemoBadge />}
          </label>
        ))}
      </fieldset>
      <Button type="submit" variant="primary" disabled={busy || !source || picked.length < 2 || !can(ws, 'EDITOR')}>
        {busy ? 'Starting…' : `Start battle (${picked.length} runs, billed)`}
      </Button>
    </form>
  );
}

export function BattlePage() {
  const ws = useCurrentWorkspace();
  const wid = ws?.id;
  const { battleId } = useParams();
  const battle = useBattle(wid, battleId);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const b = battle.data;
  const vote = async (winner) => {
    setBusy(true);
    try {
      const res = await studioApi.vote(wid, battleId, winner);
      qc.setQueryData(studioKeys.battle(wid, battleId), res);
      await qc.invalidateQueries({ queryKey: studioKeys.battles(wid) });
    } catch (e) {
      toast(e.message || 'The vote was not recorded', 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <StudioFrame view="battles" eyebrow={`Model Battle · ${ws?.name ?? ''}`} title="Model Battle">
      <p style={{ margin: '12px 0' }}>
        <Link to="/app/studio/battles">← All battles</Link>
      </p>
      {battle.isPending ? (
        <Skeleton height={200} />
      ) : battle.error ? (
        <Callout tone="bad">{battle.error.status === 404 ? 'Battle not found.' : battle.error.message}</Callout>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          <section className="card pad">
            <p className="eyebrow">Question</p>
            <h2 style={{ fontSize: 18, margin: '4px 0 8px' }}>{b.question}</h2>
            <p className="subtle mono" style={{ fontSize: 12 }}>
              Frozen context: {b.context.map((c) => `[${c.marker}] p.${c.page ?? '?'} ${c.level}`).join(' · ')}
            </p>
          </section>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${b.contestants.length}, minmax(0, 1fr))`, gap: 12 }}>
            {b.contestants.map((c) => (
              <Contestant key={c.label} c={c} winner={b.winner} />
            ))}
          </div>
          {!b.revealed ? (
            <section className="card pad row" aria-label="Vote">
              <span className="grow">{b.finished ? 'Which answer is better? Models and costs are revealed after one vote.' : 'Waiting for every answer to finish…'}</span>
              {b.contestants.map((c) => (
                <Button key={c.label} variant="primary" disabled={!b.finished || busy || !can(ws, 'EDITOR')} onClick={() => vote(c.label)}>
                  {c.label} is better
                </Button>
              ))}
              <Button disabled={!b.finished || busy || !can(ws, 'EDITOR')} onClick={() => vote('TIE')}>
                Tie
              </Button>
            </section>
          ) : (
            <Callout tone="ai">
              {b.winner === 'TIE' ? 'You called it a tie.' : `You preferred answer ${b.winner}.`} Each answer's model and cost are shown above.
            </Callout>
          )}
        </div>
      )}
    </StudioFrame>
  );
}

function Contestant({ c, winner }) {
  const done = !['QUEUED', 'RUNNING', 'STREAMING'].includes(c.status);
  return (
    <article className="card pad stack" style={{ gap: 10 }} aria-label={`Answer ${c.label}`}>
      <div className="row">
        <b style={{ fontSize: 16 }}>Answer {c.label}</b>
        {winner === c.label && <Badge tone="ok">Winner</Badge>}
        <span className="grow" />
        <StatusBadge family="run" value={c.status} />
      </div>
      {!done ? (
        <Skeleton height={60} />
      ) : c.answer ? (
        <CitedText text={c.answer} citations={Object.fromEntries(c.citations.map((x) => [x.marker, x]))} />
      ) : (
        <p className="subtle">{c.error ?? 'No answer.'}</p>
      )}
      {c.model && (
        <dl className="kv" aria-label={`Model behind answer ${c.label}`}>
          <dt>Model</dt>
          <dd>
            {c.model.displayName} {c.model.isDemo && <DemoBadge />}
          </dd>
          <dt>Cost per answer</dt>
          <dd className="mono">
            {formatUsd(c.cost.total)} <span className="subtle">{c.cost.tier}</span>
          </dd>
          <dt>Tokens</dt>
          <dd className="mono">
            {formatInt(c.tokens.input)} in · {formatInt(c.tokens.output)} out
          </dd>
          <dt>Duration</dt>
          <dd className="mono">{formatMs(c.durationMs)}</dd>
          <dt>Run</dt>
          <dd>
            <Link className="mono" to={`/app/studio/runs/${c.runId}`}>
              {c.runId.slice(0, 8)}
            </Link>
          </dd>
        </dl>
      )}
    </article>
  );
}
