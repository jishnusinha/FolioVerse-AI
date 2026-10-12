import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '@/api/client.js';
import { useCurrentWorkspace, useMe } from '@/features/auth/session.js';
import { useProjects } from '@/features/knowledge/queries.js';
import { useCostSummary, useRuns } from '@/features/runs/queries.js';
import { formatUsd } from '@/shared/format.js';
import { Icon } from '@/shared/icons.jsx';
import { DemoBadge, StatusBadge } from '@/shared/StatusBadge.jsx';
import { Callout, Empty, Skeleton } from '@/shared/ui/index.js';

function useRecentThreads(wid) {
  return useQuery({ queryKey: ['threads', wid, 'recent'], queryFn: () => api(`/workspaces/${wid}/threads`), enabled: Boolean(wid) });
}

/** Signed-in landing: pick up a conversation, see recent AI runs, projects and this month's usage. */
export function HomePage() {
  const me = useMe();
  const workspace = useCurrentWorkspace();
  const wid = workspace?.id;
  const threads = useRecentThreads(wid);
  const runs = useRuns(wid, { limit: 6 });
  const projects = useProjects(wid);
  const summary = useCostSummary(wid, 30);
  const budget = summary.data?.budget;
  const name = me.data?.user?.displayName?.split(/\s+/)[0];

  return (
    <div className="page">
      <header style={{ marginBottom: 20 }}>
        <p className="eyebrow">{workspace?.name ?? 'Workspace'}</p>
        <h1>Home</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          {name ? `Welcome back, ${name}. ` : ''}Pick up where you left off.
        </p>
      </header>
      <div className="dash">
        <section className="card pad c-8" aria-labelledby="h-continue">
          <h2 id="h-continue">Continue a conversation</h2>
          {threads.isPending ? (
            <Skeleton height={80} />
          ) : threads.error ? (
            <Callout tone="bad">Conversations could not be loaded.</Callout>
          ) : threads.data.length === 0 ? (
            <Empty>
              No conversations yet. Open a document in <Link to="/app/knowledge">Folio Knowledge</Link> and ask a question.
            </Empty>
          ) : (
            <ul className="list" style={{ marginTop: 8 }}>
              {threads.data.slice(0, 6).map((t) => (
                <li key={t.id} className="li" style={{ alignItems: 'center' }}>
                  <Icon name="knowledge" size={16} />
                  {t.projectId && t.sourceId ? (
                    <Link to={`/app/knowledge/projects/${t.projectId}/documents/${t.sourceId}`} className="grow">
                      {t.title}
                    </Link>
                  ) : (
                    <span className="grow">{t.title}</span>
                  )}
                  <span className="subtle">
                    {t.messageCount} message{t.messageCount === 1 ? '' : 's'} · {new Date(t.updatedAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card pad c-4" aria-labelledby="h-usage">
          <div className="row between">
            <h2 id="h-usage">This month</h2>
            {summary.data?.isDemo && <DemoBadge />}
          </div>
          {summary.isPending ? (
            <Skeleton height={60} />
          ) : budget ? (
            <>
              <p className="figure" style={{ marginTop: 10 }}>
                {formatUsd(budget.spent, { min: 2 })}
              </p>
              <p className="muted">
                of {formatUsd(budget.limit, { min: 2 })} budget · {formatUsd(budget.remaining, { min: 2 })} left
              </p>
            </>
          ) : (
            <p className="muted" style={{ marginTop: 10 }}>
              No budget is set for this workspace.
            </p>
          )}
          <Link to="/app/costs" className="btn ghost sm" style={{ marginTop: 12 }}>
            Open Cost Center
          </Link>
        </section>

        <section className="card pad c-6" aria-labelledby="h-runs">
          <div className="row between">
            <h2 id="h-runs">Recent AI runs</h2>
            <Link to="/app/studio" className="subtle">
              Open Studio
            </Link>
          </div>
          {runs.isPending ? (
            <Skeleton height={80} />
          ) : (runs.data ?? []).length === 0 ? (
            <Empty>Runs appear here after your first question.</Empty>
          ) : (
            <ul className="list" style={{ marginTop: 8 }}>
              {runs.data.map((r) => (
                <li key={r.id} className="li" style={{ alignItems: 'center' }}>
                  <Link to={`/app/studio/runs/${r.id}`} className="grow">
                    {r.input?.question ?? r.graph}
                  </Link>
                  {r.isDemo && <DemoBadge />}
                  <StatusBadge family="run" value={r.status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card pad c-6" aria-labelledby="h-projects">
          <div className="row between">
            <h2 id="h-projects">Projects</h2>
            <Link to="/app/knowledge" className="subtle">
              All projects
            </Link>
          </div>
          {projects.isPending ? (
            <Skeleton height={80} />
          ) : (projects.data ?? []).length === 0 ? (
            <Empty>
              No projects yet. <Link to="/app/knowledge">Create one</Link> to upload documents.
            </Empty>
          ) : (
            <ul className="list" style={{ marginTop: 8 }}>
              {projects.data.slice(0, 6).map((p) => (
                <li key={p.id} className="li" style={{ alignItems: 'center' }}>
                  <Icon name="folder" size={16} />
                  <Link to={`/app/knowledge/projects/${p.id}`} className="grow">
                    {p.name}
                  </Link>
                  <span className="subtle">
                    {p.sourceCount} document{p.sourceCount === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
