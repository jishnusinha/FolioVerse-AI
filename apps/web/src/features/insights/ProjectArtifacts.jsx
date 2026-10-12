import { useState } from 'react';
import { Link } from 'react-router';
import { formatDate } from '@/shared/format.js';
import { Badge } from '@/shared/StatusBadge.jsx';
import { Skeleton } from '@/shared/ui/index.js';
import { KIND_LABEL } from './labels.js';
import { useArtifacts } from './queries.js';

/** Saved artifacts of one project, newest first, with a kind filter. */
export function ProjectArtifacts({ wid, projectId }) {
  const [kind, setKind] = useState('');
  const list = useArtifacts(wid, { projectId, kind: kind || undefined });
  return (
    <section aria-labelledby="h-proj-arts" style={{ marginTop: 28 }}>
      <h2 className="sect-h" id="h-proj-arts">
        Artifacts
      </h2>
      <div className="row" style={{ marginBottom: 8 }}>
        <label className="row subtle" style={{ gap: 6, fontSize: 12 }}>
          Kind
          <select className="select" style={{ width: 'auto', height: 28 }} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All kinds</option>
            {Object.entries(KIND_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {list.isPending ? (
        <Skeleton height={40} />
      ) : !list.data?.length ? (
        <p className="subtle">Summaries, study material, comparisons and maps you generate from documents are saved here.</p>
      ) : (
        <ul className="list">
          {list.data.map((a) => (
            <li key={a.id} className="li">
              <Link className="grow" to={`/app/knowledge/projects/${a.projectId ?? projectId}/artifacts/${a.id}`}>
                {a.title}
              </Link>
              <Badge tone="info">{KIND_LABEL[a.kind] ?? a.kind}</Badge>
              {a.stale && <Badge tone="warn">Newer version available</Badge>}
              <span className="subtle" style={{ fontSize: 12 }}>
                {formatDate(a.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
