import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { can, useCurrentWorkspace } from '@/features/auth/session.js';
import { Badge, Button, Callout, DemoBadge, Field, Input, Select, Skeleton, StatusBadge, toast } from '@/shared/ui/index.js';
import { useDna, useManuscript, useRunsWatch, writerApi, writerKeys } from './queries.js';

const StoryGraph = lazy(() => import('./StoryGraph.jsx').then((m) => ({ default: m.StoryGraph })));

const KINDS = ['CHARACTER', 'PLACE', 'OBJECT', 'THEME', 'EVENT'].map((k) => ({ value: k, label: k[0] + k.slice(1).toLowerCase() }));
const linkLabel = (l) => l.label || l.kind.toLowerCase().replace(/_/g, ' ');

/** Evidence anchors of a fact: state badge, quote and a jump into the manuscript. */
function Evidence({ mid, evidence }) {
  if (!evidence?.length) return <span className="subtle">No evidence</span>;
  return (
    <ul className="list" style={{ fontSize: 12 }}>
      {evidence.map((e, i) => (
        <li key={i} className="li">
          <StatusBadge family="anchor" value={e.state ?? 'ORPHANED'} />
          {e.state !== 'ORPHANED' && e.nodeId ? (
            <Link to={`/app/writer/manuscripts/${mid}?scene=${e.nodeId}${e.blockId ? `&block=${e.blockId}` : ''}`}>“{e.quote}”</Link>
          ) : (
            <span className="subtle">“{e.quote}”</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Narrative DNA: story canon the author controls. AI extraction only proposes; approval makes canon. */
export function DnaPage() {
  const { manuscriptId: mid } = useParams();
  const ws = useCurrentWorkspace();
  const wid = ws?.id;
  const qc = useQueryClient();
  const m = useManuscript(wid, mid);
  const dna = useDna(wid, mid);
  const [selected, setSelected] = useState(/** @type {string | null} */ (null));
  const [watch, setWatch] = useState(/** @type {{ ids: string[], kind: 'extract'|'check' } | null} */ (null));
  const watched = useRunsWatch(wid, watch?.ids ?? []);
  const editable = can(ws, 'EDITOR');
  const refresh = () => qc.invalidateQueries({ queryKey: writerKeys.dna(wid, mid) });

  useEffect(() => {
    document.title = `Narrative DNA · ${m.data?.title ?? 'Manuscript'} · FolioVerse`;
  }, [m.data?.title]);

  useEffect(() => {
    if (!watch || watched.pending) return;
    const bad = watched.runs.find((r) => !['SUCCEEDED', 'PARTIAL'].includes(r.status));
    if (watch.kind === 'extract') {
      refresh();
      toast(bad ? `Extraction ended: ${bad.status.toLowerCase()}.` : 'Extraction finished. New facts are waiting for your approval.', bad ? 'warn' : 'ok');
    } else {
      qc.invalidateQueries({ queryKey: writerKeys.continuity(wid, mid) });
      refresh();
      toast(bad ? `Continuity check ended: ${bad.status.toLowerCase()}.` : 'Continuity check finished.', bad ? 'warn' : 'ok');
    }
    setWatch(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per finished watch
  }, [watch, watched.pending]);

  const facts = useMemo(() => dna.data?.facts ?? [], [dna.data]);
  const links = dna.data?.links ?? [];
  const entities = useMemo(() => {
    const by = new Map();
    for (const f of facts.filter((x) => x.status !== 'RETIRED')) {
      const e = by.get(f.subject) ?? { name: f.subject, kind: f.subjectKind, proposed: true };
      if (f.status === 'CANON') e.proposed = false;
      by.set(f.subject, e);
    }
    return [...by.values()];
  }, [facts]);
  const current = selected && entities.some((e) => e.name === selected) ? selected : (entities.find((e) => !e.proposed)?.name ?? entities[0]?.name ?? null);
  const proposals = facts.filter((f) => f.status === 'PROPOSED');
  const proposedLinks = links.filter((l) => l.status === 'PROPOSED');

  async function act(fn, done) {
    try {
      await fn();
      if (done) toast(done, 'ok');
    } catch (err) {
      toast(err.message, err.code === 'NO_TEXT' || err.code === 'NO_CANON' ? 'warn' : 'bad');
    }
    refresh();
  }

  const extract = () =>
    act(async () => {
      const run = await writerApi.extract(wid, mid);
      if (run.status === 'BUDGET_REJECTED') return toast('The budget limit was reached before any model call.', 'warn');
      setWatch({ ids: [run.runId], kind: 'extract' });
    });
  const check = () =>
    act(async () => {
      const res = await writerApi.checkContinuity(wid, mid);
      setWatch({ ids: res.runs.map((r) => r.runId), kind: 'check' });
    });

  if (m.isPending || dna.isPending) {
    return (
      <div className="page" aria-busy="true">
        <Skeleton height={28} width="40%" />
        <Skeleton height={300} />
      </div>
    );
  }
  if (m.error || dna.error) {
    return (
      <div className="page">
        <h1>Manuscript not found</h1>
        <Link className="btn" style={{ marginTop: 14 }} to="/app/writer">
          Back to Folio Writer
        </Link>
      </div>
    );
  }

  const sel = entities.find((e) => e.name === current);
  const selFacts = facts.filter((f) => f.subject === current);
  const demo = facts.some((f) => f.isDemo);

  return (
    <div className="page">
      <header className="home-head">
        <div>
          <p className="eyebrow">
            {m.data.title} · Narrative DNA v{dna.data.version}
          </p>
          <h1 style={{ font: '500 30px var(--fv-font-serif)' }}>Story canon & continuity</h1>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {demo && <DemoBadge />}
          <Link className="btn" to={`/app/writer/manuscripts/${mid}`}>
            Back to manuscript
          </Link>
          {editable && (
            <>
              <Button variant="ai" onClick={extract} disabled={Boolean(watch)}>
                {watch?.kind === 'extract' ? 'Extracting…' : 'Extract from manuscript'}
              </Button>
              <Button variant="primary" onClick={check} disabled={Boolean(watch)}>
                {watch?.kind === 'check' ? 'Checking…' : 'Run continuity check'}
              </Button>
            </>
          )}
        </div>
      </header>
      <Callout tone="ai" className="w-howto">
        <b>How story memory works.</b> AI may <i>propose</i> facts (◇). Only facts you approve become <b>Canon</b> (■), and continuity checks compare scenes with canon. Retired facts (□) stay in the
        ledger so earlier checks remain explainable.
      </Callout>
      <div className="dash">
        <section className="card pad c-7" aria-labelledby="h-g">
          <h2 className="sect-h" id="h-g">
            Relationships
          </h2>
          <Suspense fallback={<Skeleton height={360} />}>
            <StoryGraph entities={entities} links={links} selected={current} onSelect={setSelected} />
          </Suspense>
        </section>
        <section className="card pad c-5" aria-labelledby="h-e">
          <h2 className="sect-h" id="h-e">
            {sel ? sel.name : 'Nothing selected'}
          </h2>
          {sel && <p className="muted">{sel.kind[0] + sel.kind.slice(1).toLowerCase()}</p>}
          <ul className="list" style={{ marginTop: 10 }}>
            {selFacts.length ? (
              selFacts.map((f) => (
                <li key={f.id} className="li">
                  <div className="grow">
                    {f.statement}
                    <div className="row" style={{ marginTop: 4, flexWrap: 'wrap' }}>
                      <StatusBadge family="dna" value={f.status} />
                      <StatusBadge family="origin" value={f.origin} />
                      {f.note && <span className="subtle">{f.note}</span>}
                    </div>
                    <Evidence mid={mid} evidence={f.evidence} />
                  </div>
                </li>
              ))
            ) : (
              <li className="li subtle">No recorded facts yet.</li>
            )}
          </ul>
        </section>
        <section className="card pad c-6" aria-labelledby="h-p">
          <h2 className="sect-h" id="h-p">
            Awaiting your approval
          </h2>
          {proposals.length + proposedLinks.length === 0 ? (
            <p className="empty">No proposals waiting. New extractions appear here first.</p>
          ) : (
            <ul className="list" aria-label="Proposed facts">
              {proposals.map((f) => (
                <li key={f.id} className="li">
                  <div className="grow">
                    <p>{f.statement}</p>
                    <div className="row" style={{ marginTop: 4, flexWrap: 'wrap' }}>
                      <StatusBadge family="dna" value="PROPOSED" />
                      <StatusBadge family="origin" value={f.origin} />
                      {f.confidence != null && <span className="mono subtle">confidence {Number(f.confidence).toFixed(2)}</span>}
                      {f.note && <Badge tone="warn">{f.note}</Badge>}
                    </div>
                    <Evidence mid={mid} evidence={f.evidence} />
                  </div>
                  {editable && (
                    <div className="row">
                      <Button size="sm" variant="primary" aria-label={`Approve: ${f.statement}`} onClick={() => act(() => writerApi.updateFact(wid, mid, f.id, { status: 'CANON' }), 'Approved as canon.')}>
                        Approve
                      </Button>
                      <Button size="sm" aria-label={`Reject: ${f.statement}`} onClick={() => act(() => writerApi.updateFact(wid, mid, f.id, { status: 'RETIRED' }))}>
                        Reject
                      </Button>
                    </div>
                  )}
                </li>
              ))}
              {proposedLinks.map((l) => (
                <li key={l.id} className="li">
                  <div className="grow">
                    <p>
                      {l.source} — {linkLabel(l)} — {l.target}
                    </p>
                    <div className="row" style={{ marginTop: 4 }}>
                      <StatusBadge family="dna" value="PROPOSED" />
                      <StatusBadge family="origin" value={l.origin} />
                    </div>
                  </div>
                  {editable && (
                    <div className="row">
                      <Button size="sm" variant="primary" onClick={() => act(() => writerApi.updateLink(wid, mid, l.id, { status: 'CANON' }))}>
                        Approve
                      </Button>
                      <Button size="sm" onClick={() => act(() => writerApi.updateLink(wid, mid, l.id, { status: 'RETIRED' }))}>
                        Reject
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card pad c-6" aria-labelledby="h-c">
          <h2 className="sect-h" id="h-c">
            Continuity alerts
          </h2>
          {dna.data.openIssues ? (
            <p>
              <Badge tone="warn" glyph="!">
                {dna.data.openIssues}
              </Badge>{' '}
              open issue{dna.data.openIssues === 1 ? '' : 's'} against canon.{' '}
              <Link to={`/app/writer/manuscripts/${mid}/continuity`}>Review continuity</Link>
            </p>
          ) : (
            <p className="empty">No open continuity issues.</p>
          )}
          {editable && <AddFact wid={wid} mid={mid} onDone={refresh} />}
        </section>
        <section className="card c-12" aria-labelledby="h-cl">
          <div className="pad" style={{ paddingBottom: 0 }}>
            <h2 id="h-cl">Canon ledger</h2>
          </div>
          <div style={{ overflow: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Statement</th>
                  <th scope="col">Status</th>
                  <th scope="col">Origin</th>
                  <th scope="col">Evidence</th>
                  {editable && (
                    <th scope="col">
                      <span className="sr">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {facts
                  .filter((f) => f.status !== 'PROPOSED')
                  .map((f) => (
                    <tr key={f.id}>
                      <td>{f.statement}</td>
                      <td>
                        <StatusBadge family="dna" value={f.status} />
                      </td>
                      <td>
                        <StatusBadge family="origin" value={f.origin} />
                      </td>
                      <td>
                        <Evidence mid={mid} evidence={f.evidence} />
                      </td>
                      {editable && (
                        <td>
                          {f.status === 'CANON' ? (
                            <Button size="sm" variant="ghost" onClick={() => act(() => writerApi.updateFact(wid, mid, f.id, { status: 'RETIRED' }))}>
                              Retire
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => act(() => writerApi.updateFact(wid, mid, f.id, { status: 'CANON' }))}>
                              Reinstate
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function AddFact({ wid, mid, onDone }) {
  const [subject, setSubject] = useState('');
  const [kind, setKind] = useState('CHARACTER');
  const [predicate, setPredicate] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    if (!subject.trim() || !predicate.trim() || !value.trim()) return setError('Give a subject, what the fact is about and its value.');
    try {
      await writerApi.createFact(wid, mid, { subject: subject.trim(), subjectKind: kind, predicate: predicate.trim(), value: value.trim() });
      setPredicate('');
      setValue('');
      setError('');
      toast('Added to canon.', 'ok');
      onDone();
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <form onSubmit={submit} className="stack" style={{ gap: 8, marginTop: 16 }} aria-label="Add a canon fact">
      <h3 className="sect-h">Add a canon fact</h3>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Subject">
          <Input value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} placeholder="Mara" />
        </Field>
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value)} options={KINDS} />
        </Field>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Fact">
          <Input value={predicate} maxLength={120} onChange={(e) => setPredicate(e.target.value)} placeholder="eye color" />
        </Field>
        <Field label="Value" error={error || undefined}>
          <Input value={value} maxLength={200} onChange={(e) => setValue(e.target.value)} placeholder="green" />
        </Field>
      </div>
      <Button size="sm" type="submit">
        Add to canon
      </Button>
    </form>
  );
}
