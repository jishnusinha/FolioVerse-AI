import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client.js';
import { Button, Callout, Empty, Skeleton } from '@/shared/ui/index.js';
import { Icon } from '@/shared/icons.jsx';
import { Page, PageHeader } from '@/shared/layout/Panes.jsx';
import { can, useCurrentWorkspace } from '@/features/auth/session.js';
import { WorkspaceSwitcher } from '@/features/workspaces/WorkspaceSwitcher.jsx';
import { NewProjectDialog } from './dialogs.jsx';
import { keys, useProjects } from './queries.js';
import { relativeTime } from './files.js';

export function KnowledgeHomePage() {
  const ws = useCurrentWorkspace();
  const projects = useProjects(ws?.id);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const knowledge = (projects.data ?? []).filter((p) => p.kind === 'KNOWLEDGE' && !p.archivedAt);

  return (
    <Page>
      <PageHeader
        eyebrow="Folio Knowledge"
        title="Folio Knowledge"
        lede="Research projects hold your documents. Upload files, organise them in folders and ask grounded questions."
        actions={
          <>
            <Link className="btn ghost" to="/app/knowledge/trash">
              <Icon name="trash" size={16} />
              Trash
            </Link>
            {can(ws, 'EDITOR') && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Icon name="plus" size={16} />
                New project
              </Button>
            )}
          </>
        }
      />
      <div className="row" style={{ marginBottom: 16, maxWidth: 320 }}>
        <WorkspaceSwitcher />
      </div>
      {projects.isPending ? (
        <div className="stack" style={{ gap: 10 }} aria-busy="true">
          <Skeleton height={64} />
          <Skeleton height={64} />
        </div>
      ) : projects.error ? (
        <Callout tone="bad" role="alert">
          Projects could not be loaded: {projects.error.message}
        </Callout>
      ) : knowledge.length === 0 ? (
        <Empty>No research projects in this workspace yet.</Empty>
      ) : (
        <ul className="modes" aria-label="Research projects" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {knowledge.map((p) => (
            <li key={p.id}>
              <Link className="mode" to={`/app/knowledge/projects/${p.id}`}>
                <span className="eyebrow">Research project</span>
                <h2>{p.name}</h2>
                {p.description && <p className="muted">{p.description}</p>}
                <p className="subtle" style={{ marginTop: 8, fontSize: 12 }}>
                  {p.sourceCount} document{p.sourceCount === 1 ? '' : 's'} · updated {relativeTime(p.updatedAt)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <NewProjectDialog
        key={creating ? 'open' : 'closed'}
        open={creating}
        onOpenChange={setCreating}
        onSubmit={async (body) => {
          const p = await api(`/workspaces/${ws.id}/projects`, { method: 'POST', body: { ...body, kind: 'KNOWLEDGE' } });
          await qc.invalidateQueries({ queryKey: keys.projects(ws.id) });
          navigate(`/app/knowledge/projects/${p.id}`);
        }}
      />
    </Page>
  );
}
