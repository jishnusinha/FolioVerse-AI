import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { can, useCurrentWorkspace } from '@/features/auth/session.js';
import { WorkspaceSwitcher } from '@/features/workspaces/WorkspaceSwitcher.jsx';
import { relativeTime } from '@/features/knowledge/files.js';
import { Icon } from '@/shared/icons.jsx';
import { Page, PageHeader } from '@/shared/layout/Panes.jsx';
import { Button, Callout, Dialog, Empty, Field, Input, Skeleton } from '@/shared/ui/index.js';
import { useManuscripts, writerApi, writerKeys } from './queries.js';

export function WriterHomePage() {
  const ws = useCurrentWorkspace();
  const list = useManuscripts(ws?.id);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const rows = (list.data ?? []).filter((m) => !m.archivedAt);

  async function create(e) {
    e.preventDefault();
    if (!title.trim()) return setError('Give the manuscript a title.');
    setBusy(true);
    try {
      const m = await writerApi.createManuscript(ws.id, { title: title.trim() });
      await qc.invalidateQueries({ queryKey: writerKeys.manuscripts(ws.id) });
      navigate(`/app/writer/manuscripts/${m.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Folio Writer"
        title="Folio Writer"
        lede="Draft long-form fiction with an outline, revision history, a story canon you control and AI suggestions that change nothing until you accept them."
        actions={
          can(ws, 'EDITOR') && (
            <Button variant="primary" onClick={() => setOpen(true)}>
              <Icon name="plus" size={16} />
              New manuscript
            </Button>
          )
        }
      />
      <div className="row" style={{ marginBottom: 16, maxWidth: 320 }}>
        <WorkspaceSwitcher />
      </div>
      {list.isPending ? (
        <div className="stack" style={{ gap: 10 }} aria-busy="true">
          <Skeleton height={64} />
          <Skeleton height={64} />
        </div>
      ) : list.error ? (
        <Callout tone="bad" role="alert">
          Manuscripts could not be loaded: {list.error.message}
        </Callout>
      ) : rows.length === 0 ? (
        <Empty>No manuscripts in this workspace yet.</Empty>
      ) : (
        <ul className="modes" aria-label="Manuscripts" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {rows.map((m) => (
            <li key={m.id}>
              <Link className="mode" to={`/app/writer/manuscripts/${m.id}`}>
                <span className="eyebrow">Manuscript</span>
                <h2>{m.title}</h2>
                <p className="subtle" style={{ marginTop: 8, fontSize: 12 }}>
                  {m.words.toLocaleString()} words · {m.scenes} scene{m.scenes === 1 ? '' : 's'} · updated {relativeTime(m.updatedAt)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          setError('');
        }}
        title="New manuscript"
        description="A writing project is created with Part One, Chapter 1 and an empty first scene."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" form="new-manuscript" disabled={busy}>
              Create
            </Button>
          </>
        }
      >
        <form id="new-manuscript" onSubmit={create}>
          <Field label="Title" error={error || undefined}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />
          </Field>
        </form>
      </Dialog>
    </Page>
  );
}
