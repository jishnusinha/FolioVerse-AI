import { Suspense, lazy, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { can, useCurrentWorkspace } from '@/features/auth/session.js';
import { cn } from '@/shared/cn.js';
import { Empty, Field, Input, Skeleton } from '@/shared/ui/index.js';
import { OutlineTree, scenesInOrder } from './OutlineTree.jsx';
import { useManuscript, writerApi, writerKeys } from './queries.js';

const SceneWorkspace = lazy(() => import('./SceneWorkspace.jsx').then((m) => ({ default: m.SceneWorkspace })));

/** Folio Writer: outline, scene editor and the writing assistant side panel. */
export function ManuscriptPage() {
  const { manuscriptId } = useParams();
  const ws = useCurrentWorkspace();
  const wid = ws?.id;
  const m = useManuscript(wid, manuscriptId);
  const [params, setParams] = useSearchParams();
  const [focus, setFocus] = useState(false);
  const editable = can(ws, 'EDITOR');

  useEffect(() => {
    if (m.data) document.title = `${m.data.title} · FolioVerse`;
  }, [m.data]);

  if (m.isPending) {
    return (
      <div className="page" aria-busy="true">
        <Skeleton height={28} width="40%" />
        <Skeleton height={400} />
      </div>
    );
  }
  if (m.error || !m.data) {
    return (
      <div className="page">
        <h1>Manuscript not found</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          It may have been deleted, or it belongs to a workspace you are not a member of.
        </p>
        <Link className="btn" style={{ marginTop: 14 }} to="/app/writer">
          Back to Folio Writer
        </Link>
      </div>
    );
  }

  const manuscript = m.data;
  const scenes = scenesInOrder(manuscript.nodes);
  const sceneId = scenes.some((s) => s.id === params.get('scene')) ? params.get('scene') : (scenes[0]?.id ?? null);
  const select = (id) => setParams(id ? { scene: id } : {}, { replace: false });

  return (
    <div className={cn('panes', 'w-panes', focus && 'focus')}>
      <aside className="ctx" aria-label="Manuscript outline">
        <OutlineTree wid={wid} manuscript={manuscript} sceneId={sceneId} onSelect={select} editable={editable} />
        {editable && <DailyGoal wid={wid} manuscript={manuscript} />}
      </aside>
      {sceneId ? (
        <Suspense
          fallback={
            <section className="pane" aria-busy="true">
              <div className="canvas">
                <Skeleton height={400} />
              </div>
            </section>
          }
        >
          <SceneWorkspace
            key={sceneId}
            wid={wid}
            manuscript={manuscript}
            sceneId={sceneId}
            editable={editable}
            focus={focus}
            setFocus={setFocus}
            jumpTo={params.get('block')}
          />
        </Suspense>
      ) : (
        <section className="pane">
          <div className="page">
            <Empty>This manuscript has no scenes yet. Add a part, a chapter and a scene from the outline.</Empty>
          </div>
        </section>
      )}
    </div>
  );
}

function DailyGoal({ wid, manuscript }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(String(manuscript.dailyGoal ?? 0));
  async function save() {
    const goal = Math.max(0, Math.min(100_000, Number(value) || 0));
    if (goal === manuscript.dailyGoal) return;
    const next = await writerApi.updateManuscript(wid, manuscript.id, { dailyGoal: goal });
    qc.setQueryData(writerKeys.manuscript(wid, manuscript.id), next);
  }
  return (
    <div style={{ padding: '16px 8px 4px' }}>
      <Field label="Daily goal (words)">
        <Input type="number" min={0} max={100000} step={50} value={value} onChange={(e) => setValue(e.target.value)} onBlur={save} />
      </Field>
    </div>
  );
}
