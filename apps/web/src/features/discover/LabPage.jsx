import { useEffect, useRef, useState } from 'react';
import { useCurrentWorkspace } from '@/features/auth/session.js';
import { Button, Callout, DemoBadge, Skeleton } from '@/shared/ui/index.js';
import { EvaluationPanel } from './EvaluationPanel.jsx';
import { DiscoverHeader } from './parts.jsx';
import { DEFAULT_LAMBDA, DEFAULT_WEIGHTS, FACTORS, discoverApi, rankShift, useLatestSet, useRecModel } from './queries.js';

const RERANK_DELAY_MS = 250;

function Shift({ value }) {
  if (value === undefined) return <span className="subtle">–</span>;
  if (value === null) return <span className="mono rank-up">new</span>;
  if (value === 0) return <span className="mono subtle">=</span>;
  return (
    <span className={`mono ${value > 0 ? 'rank-up' : 'rank-down'}`} aria-label={`${value > 0 ? 'up' : 'down'} ${Math.abs(value)}`}>
      {value > 0 ? '▲' : '▼'}
      {Math.abs(value)}
    </span>
  );
}

function StageCards({ set }) {
  const st = set.stages ?? {};
  const c = st.candidates ?? {};
  const d = st.diversity ?? {};
  const cards = [
    [
      '1 · Candidate retrieval',
      set.coldStart
        ? `Cold start: top ${c.prior ?? c.unique ?? 0} titles by quality prior`
        : `Semantic ${c.semantic ?? 0} · TF-IDF ${c.tfidf ?? 0} · theme overlap ${c.theme ?? 0} · collaborative ${c.collaborative ?? 0} → ${c.unique ?? 0} unique candidates`,
    ],
    ['2 · Hybrid scoring', `${st.scored ?? 0} scored by a linear weighted sum; each factor value is stored per candidate so explanations are exact`],
    [
      `3 · Diversity (MMR, λ = ${set.lambda})`,
      `At most ${d.perCreator ?? 2} per creator and ${d.perFranchise ?? 2} per franchise${d.mediaCap ? ` · at most ${d.mediaCap} of one medium` : ''}${d.skippedByCaps ? ` · ${d.skippedByCaps} skipped by caps` : ''}`,
    ],
    ['4 · Final list', `${st.final ?? set.items.length} shown · ${set.latencyMs} ms · ${set.modelVersion}${set.mode === 'LAB' ? ' · Lab sets log no impressions' : ''}`],
  ];
  return cards.map(([h, p]) => (
    <section key={h} className="card pad c-6">
      <p className="eyebrow">{h}</p>
      <p style={{ marginTop: 8, fontSize: 13 }}>{p}</p>
    </section>
  ));
}

function ModelCard({ wid }) {
  const model = useRecModel(wid);
  return (
    <section className="card pad c-6" aria-labelledby="lab-model">
      <h2 className="sect-h" id="lab-model">
        Served model
      </h2>
      {model.isPending ? (
        <Skeleton height={80} />
      ) : model.error ? (
        <p className="subtle">The model manifest is unavailable because the AI service is not reachable.</p>
      ) : (
        <dl className="kv">
          <dt>Artifact</dt>
          <dd className="mono">
            {model.data.label} {model.data.isDemo && <DemoBadge />}
          </dd>
          <dt>Algorithm</dt>
          <dd>{model.data.algorithm}</dd>
          <dt>Trained</dt>
          <dd className="mono">{model.data.createdAt ? new Date(model.data.createdAt).toLocaleString() : '—'}</dd>
          <dt>Training data</dt>
          <dd className="mono">
            {model.data.training?.items ?? '—'} titles · {model.data.training?.users ?? '—'} users · {model.data.training?.interactions ?? '—'} interactions
          </dd>
          <dt>Parameters</dt>
          <dd className="mono">
            LSA {model.data.params?.lsaDims ?? '—'} dims · NMF {model.data.params?.cfFactors ?? '—'} factors · {model.data.vocabulary ?? '—'} terms
          </dd>
          <dt>Checksum</dt>
          <dd className="mono" style={{ overflowWrap: 'anywhere' }}>
            {model.data.files?.[0]?.sha256?.slice(0, 16) ?? '—'}…
          </dd>
        </dl>
      )}
    </section>
  );
}

/**
 * Recommendation Lab: re-ranks the member's last Discover request live under adjusted weights, λ and caps, shows the
 * logged stage counts and rank movement against the default weights, and runs offline evaluation.
 */
export function LabPage() {
  const ws = useCurrentWorkspace();
  const wid = ws?.id;
  const discoverSet = useLatestSet(wid, 'DISCOVER');
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [lambda, setLambda] = useState(DEFAULT_LAMBDA);
  const [perCreator, setPerCreator] = useState(2);
  const [balanceMedia, setBalanceMedia] = useState(true);
  const [baseline, setBaseline] = useState(null);
  const [current, setCurrent] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const request = discoverSet.data;

  useEffect(() => {
    if (!wid || !request) return undefined;
    const mine = ++seq.current;
    const filters = request.filters ?? {};
    const body = {
      query: request.query ?? undefined,
      kind: filters.kind ?? undefined,
      genres: filters.genres ?? [],
      moods: filters.moods ?? [],
      k: 10,
      lab: { weights, lambda, perCreator, balanceMedia },
    };
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await discoverApi.recommend(wid, body);
        if (mine !== seq.current) return;
        setCurrent(res);
        setError(null);
        setBaseline((b) => b ?? res);
      } catch (e) {
        if (mine === seq.current) setError(e);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, RERANK_DELAY_MS);
    return () => clearTimeout(t);
  }, [wid, request, weights, lambda, perCreator, balanceMedia]);

  const reset = () => {
    setWeights(DEFAULT_WEIGHTS);
    setLambda(DEFAULT_LAMBDA);
    setPerCreator(2);
    setBalanceMedia(true);
  };
  const shifts = rankShift(baseline, current);
  const describe = request?.id ? (request.query ? `“${request.query}”` : 'your taste profile') : 'your taste profile (no Discover request yet)';

  return (
    <div className="page">
      <DiscoverHeader lab />
      <p className="callout ai" style={{ marginBottom: 18 }}>
        How your last Discover request is answered, stage by stage. Move the weights to re-rank it live; every change is logged as a Lab set (no impressions) with
        the counts and factor values shown here. Catalog, users and metrics are synthetic DEMO data.
      </p>
      {error && (
        <Callout tone={error.status === 503 ? 'warn' : 'bad'} role="alert">
          {error.status === 503 ? 'The recommender is not available right now.' : `Re-ranking failed: ${error.message}`}
        </Callout>
      )}
      <div className="dash">
        {current ? (
          <StageCards set={current} />
        ) : (
          <section className="card pad c-12">
            <Skeleton height={60} />
          </section>
        )}

        <section className="card pad c-6 lab-w" aria-labelledby="lab-weights">
          <div className="row between">
            <h2 className="sect-h" id="lab-weights" style={{ margin: 0 }}>
              Scoring weights
            </h2>
            <Button size="sm" onClick={reset}>
              Reset
            </Button>
          </div>
          <table className="table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th scope="col">Signal</th>
                <th scope="col" style={{ width: '45%' }}>
                  Requested
                </th>
                <th scope="col" className="num">
                  Effective
                </th>
              </tr>
            </thead>
            <tbody>
              {FACTORS.map(([key, label]) => (
                <tr key={key}>
                  <td>
                    <label htmlFor={`w-${key}`}>{label}</label>
                  </td>
                  <td>
                    <span className="row" style={{ flexWrap: 'nowrap' }}>
                      <input
                        id={`w-${key}`}
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={weights[key]}
                        onChange={(e) => setWeights((w) => ({ ...w, [key]: Number(e.target.value) }))}
                      />
                      <span className="mono subtle" style={{ width: 34 }}>
                        {weights[key].toFixed(2)}
                      </span>
                    </span>
                  </td>
                  <td className="num mono">{current?.weights?.[key] != null ? current.weights[key].toFixed(3) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="subtle" style={{ fontSize: 11.5, marginTop: 6 }}>
            Weights are normalised to sum to 1, then the quality prior is capped at 0.10 so popularity cannot dominate; the capped excess is dropped, not
            redistributed.
          </p>
          <div className="stack" style={{ gap: 10, marginTop: 14 }}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <label htmlFor="lab-lambda" style={{ width: 170, flexShrink: 0 }}>
                Relevance vs diversity (λ)
              </label>
              <input id="lab-lambda" type="range" min={0} max={1} step={0.05} value={lambda} onChange={(e) => setLambda(Number(e.target.value))} />
              <span className="mono subtle" style={{ width: 34 }}>
                {lambda.toFixed(2)}
              </span>
            </div>
            <div className="row">
              <label htmlFor="lab-creator" style={{ width: 170 }}>
                Max per creator
              </label>
              <select id="lab-creator" className="input" style={{ width: 80 }} value={perCreator} onChange={(e) => setPerCreator(Number(e.target.value))}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <input id="lab-balance" type="checkbox" checked={balanceMedia} onChange={(e) => setBalanceMedia(e.target.checked)} />
              <label htmlFor="lab-balance">Balance books and films</label>
            </div>
          </div>
        </section>

        <section className="card pad c-6" aria-labelledby="lab-list">
          <h2 className="sect-h" id="lab-list">
            Ranked list {busy && <span className="subtle">· re-ranking…</span>}
          </h2>
          <p className="subtle" style={{ fontSize: 12, marginBottom: 8 }}>
            For {describe}. Movement is against the default weights.
          </p>
          {current ? (
            <table className="table" aria-label="Re-ranked titles" aria-busy={busy}>
              <thead>
                <tr>
                  <th scope="col" className="num">
                    #
                  </th>
                  <th scope="col">Move</th>
                  <th scope="col">Title</th>
                  <th scope="col" className="num">
                    Score
                  </th>
                </tr>
              </thead>
              <tbody>
                {current.items.map((r) => (
                  <tr key={r.itemId}>
                    <td className="num mono">{r.rank}</td>
                    <td>
                      <Shift value={shifts[r.itemId]} />
                    </td>
                    <td>
                      {r.item.title} <span className="subtle">· {r.item.kind === 'FILM' ? 'Film' : 'Book'}</span>
                    </td>
                    <td className="num mono">{r.score.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Skeleton height={200} />
          )}
        </section>

        <ModelCard wid={wid} />
        <section className="card pad c-6" aria-labelledby="lab-profile">
          <h2 className="sect-h" id="lab-profile">
            Profile used
          </h2>
          {current?.profile ? (
            <dl className="kv">
              <dt>Positive signals</dt>
              <dd className="mono">{current.profile.positives}</dd>
              <dt>Negative signals</dt>
              <dd className="mono">{current.profile.negatives}</dd>
              <dt>Library context</dt>
              <dd className="mono">{current.profile.context ?? 0} books</dd>
              <dt>Top themes</dt>
              <dd>{current.profile.topThemes?.length ? current.profile.topThemes.join(', ') : '—'}</dd>
            </dl>
          ) : (
            <Skeleton height={80} />
          )}
        </section>

        <EvaluationPanel headingId="lab-eval" />
      </div>
    </div>
  );
}
