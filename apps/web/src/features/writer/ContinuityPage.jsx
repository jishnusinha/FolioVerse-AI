import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { can, useCurrentWorkspace } from '@/features/auth/session.js';
import { Button, Empty, Segmented, Skeleton, toast } from '@/shared/ui/index.js';
import { useContinuity, useManuscript, useRunsWatch, writerApi, writerKeys } from './queries.js';
import { IssueCard } from './ScenePanels.jsx';

const FILTERS = [
  { value: 'OPEN', label: 'Open' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'DISMISSED', label: 'Dismissed' },
  { value: 'ALL', label: 'All' },
];

/** Every continuity issue in the manuscript, with paired evidence and a jump into the scene. */
export function ContinuityPage() {
  const { manuscriptId: mid } = useParams();
  const ws = useCurrentWorkspace();
  const wid = ws?.id;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const m = useManuscript(wid, mid);
  const issues = useContinuity(wid, mid);
  const [filter, setFilter] = useState('OPEN');
  const [watch, setWatch] = useState(/** @type {string[]} */ ([]));
  const watched = useRunsWatch(wid, watch);
  const editable = can(ws, 'EDITOR');

  useEffect(() => {
    document.title = `Continuity · ${m.data?.title ?? 'Manuscript'} · FolioVerse`;
  }, [m.data?.title]);

  useEffect(() => {
    if (!watch.length || watched.pending) return;
    qc.invalidateQueries({ queryKey: writerKeys.continuity(wid, mid) });
    toast('Continuity check finished.', 'ok');
    setWatch([]);
  }, [watch, watched.pending, qc, wid, mid]);

  async function check() {
    try {
      const res = await writerApi.checkContinuity(wid, mid);
      setWatch(res.runs.map((r) => r.runId));
    } catch (err) {
      toast(err.message, err.code === 'NO_CANON' || err.code === 'NO_TEXT' ? 'warn' : 'bad');
    }
  }

  async function setState(i, state) {
    try {
      await writerApi.updateIssue(wid, mid, i.id, state);
    } catch (err) {
      toast(err.message, 'bad');
    }
    qc.invalidateQueries({ queryKey: writerKeys.continuity(wid, mid) });
  }

  if (m.error) {
    return (
      <div className="page">
        <h1>Manuscript not found</h1>
        <Link className="btn" style={{ marginTop: 14 }} to="/app/writer">
          Back to Folio Writer
        </Link>
      </div>
    );
  }

  const all = issues.data ?? [];
  const rows = filter === 'ALL' ? all : all.filter((i) => i.state === filter);
  const count = (s) => all.filter((i) => i.state === s).length;

  return (
    <div className="page">
      <header className="home-head">
        <div>
          <p className="eyebrow">{m.data?.title ?? 'Manuscript'} · Continuity</p>
          <h1 style={{ font: '500 30px var(--fv-font-serif)' }}>Continuity issues</h1>
          <p className="lede">Scenes compared with approved canon. Each issue pairs the passage with the canon fact it contradicts.</p>
        </div>
        <div className="row">
          <Link className="btn" to={`/app/writer/manuscripts/${mid}/dna`}>
            Narrative DNA
          </Link>
          {editable && (
            <Button variant="primary" onClick={check} disabled={watched.pending}>
              {watched.pending ? 'Checking…' : 'Check all scenes'}
            </Button>
          )}
        </div>
      </header>
      <div className="row" style={{ marginBottom: 14 }}>
        <Segmented
          label="Show issues"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({ value: f.value, label: f.value === 'ALL' ? `${f.label} (${all.length})` : `${f.label} (${count(f.value)})` }))}
        />
      </div>
      {issues.isPending ? (
        <Skeleton height={120} />
      ) : rows.length === 0 ? (
        <Empty>{filter === 'OPEN' ? 'No open continuity issues.' : 'Nothing here.'}</Empty>
      ) : (
        <ul className="stack" style={{ gap: 12, listStyle: 'none', margin: 0, padding: 0, maxWidth: 760 }} aria-label="Continuity issues">
          {rows.map((i) => (
            <IssueCard
              key={i.id}
              issue={i}
              showScene
              editable={editable}
              onIssue={setState}
              onJump={(x) => {
                const a = (x.anchors ?? []).find((y) => y.role === 'scene');
                navigate(`/app/writer/manuscripts/${mid}?scene=${x.nodeId}&block=${a?.blockId ?? x.blockId ?? ''}`);
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
