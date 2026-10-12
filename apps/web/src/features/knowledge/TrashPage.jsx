import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client.js';
import { Button, Callout, Empty, Skeleton } from '@/shared/ui/index.js';
import { toast } from '@/shared/ui/toast.jsx';
import { Page, PageHeader } from '@/shared/layout/Panes.jsx';
import { can, useCurrentWorkspace } from '@/features/auth/session.js';
import { fileType, relativeTime } from './files.js';
import { keys, useTrash } from './queries.js';

const purgeLabel = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function TrashTable({ caption, rows, kindLabel, canRestore, onRestore, restoring }) {
  if (rows.length === 0) return <Empty>No {kindLabel} in trash.</Empty>;
  return (
    <div className="card" style={{ overflow: 'auto' }}>
      <table className="table">
        <caption className="sr">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Deleted</th>
            <th scope="col">Permanently removed</th>
            <th scope="col">
              <span className="sr">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.mimeType && (
                  <span className="ft" data-t={fileType(r)} style={{ marginRight: 8 }}>
                    {fileType(r)}
                  </span>
                )}
                {r.title ?? r.name}
              </td>
              <td className="subtle">{relativeTime(r.deletedAt)}</td>
              <td className="subtle">{r.purgeAt ? purgeLabel(r.purgeAt) : '—'}</td>
              <td className="num">
                {canRestore && (
                  <Button size="sm" onClick={() => onRestore(r)} disabled={restoring}>
                    Restore
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TrashPage() {
  const ws = useCurrentWorkspace();
  const wid = ws?.id;
  const trash = useTrash(wid);
  const qc = useQueryClient();
  const restore = useMutation({
    mutationFn: ({ kind, id }) => api(`/workspaces/${wid}/${kind}/${id}/restore`, { method: 'POST' }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.trash(wid) }),
        qc.invalidateQueries({ queryKey: ['sources', wid] }),
        qc.invalidateQueries({ queryKey: keys.projects(wid) }),
      ]);
      toast('Restored.', 'ok');
    },
    onError: (e) => toast(e.message, 'bad'),
  });

  return (
    <Page>
      <PageHeader
        eyebrow="Folio Knowledge"
        title="Trash"
        lede={`Deleted projects and documents stay here for ${trash.data?.purgeAfterDays ?? 30} days, then they are permanently removed with their stored files and index entries.`}
        actions={<Link to="/app/knowledge">Back to projects</Link>}
      />
      {trash.isPending ? (
        <Skeleton height={80} />
      ) : trash.error ? (
        <Callout tone="bad" role="alert">
          Trash could not be loaded: {trash.error.message}
        </Callout>
      ) : (
        <div className="stack" style={{ gap: 24 }}>
          <section aria-labelledby="h-trash-docs">
            <h2 className="sect-h" id="h-trash-docs">
              Documents
            </h2>
            <TrashTable
              caption="Deleted documents"
              kindLabel="documents"
              rows={trash.data.sources}
              canRestore={can(ws, 'EDITOR')}
              restoring={restore.isPending}
              onRestore={(r) => restore.mutate({ kind: 'sources', id: r.id })}
            />
          </section>
          <section aria-labelledby="h-trash-projects">
            <h2 className="sect-h" id="h-trash-projects">
              Projects
            </h2>
            <TrashTable
              caption="Deleted projects"
              kindLabel="projects"
              rows={trash.data.projects}
              canRestore={can(ws, 'ADMIN')}
              restoring={restore.isPending}
              onRestore={(r) => restore.mutate({ kind: 'projects', id: r.id })}
            />
          </section>
        </div>
      )}
    </Page>
  );
}
