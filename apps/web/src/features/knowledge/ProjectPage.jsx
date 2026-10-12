import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client.js';
import { Button, Callout, DropdownMenu, Empty, Input, KeyValue, Segmented, Skeleton, StageTrack, StatusBadge } from '@/shared/ui/index.js';
import { toast } from '@/shared/ui/toast.jsx';
import { Icon } from '@/shared/icons.jsx';
import { BUSY_INGEST, stateOf } from '@/shared/states.js';
import { can, useCurrentWorkspace } from '@/features/auth/session.js';
import { WorkspaceSwitcher } from '@/features/workspaces/WorkspaceSwitcher.jsx';
import { ConfirmDialog, MoveDialog, NameDialog, NewFolderDialog } from './dialogs.jsx';
import { fileType, folderScope, folderTree, formatBytes, relativeTime } from './files.js';
import { keys, useFolders, useProject, useProjects, useSource, useSources } from './queries.js';
import { UploadDialog } from './UploadDialog.jsx';

const TYPES = ['All', 'PDF', 'DOCX', 'MD', 'TXT', 'EPUB'];
const ATTENTION = new Set(['FAILED', 'PARTIAL', 'QUARANTINED']);

function TreeNode({ node, depth, selected, open, onToggle, onSelect, counts }) {
  const hasKids = node.children.length > 0;
  const isOpen = open.has(node.id);
  return (
    <li>
      <button
        type="button"
        className="tnode"
        aria-current={selected === node.id}
        aria-expanded={hasKids ? isOpen : undefined}
        onClick={() => {
          onSelect(node.id);
          if (hasKids) onToggle(node.id);
        }}
      >
        {hasKids ? (
          <span className="tw">
            <Icon name="chev" size={13} />
          </span>
        ) : (
          <span style={{ width: 13 }} />
        )}
        <Icon name="folder" size={15} />
        <span className="grow">{node.name}</span>
        <span className="mono subtle">{counts.get(node.id) ?? 0}</span>
      </button>
      {hasKids && isOpen && (
        <ul>
          {node.children.map((c) => (
            <TreeNode key={c.id} node={c} depth={depth + 1} selected={selected} open={open} onToggle={onToggle} onSelect={onSelect} counts={counts} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Preview({ wid, projectId, sourceId, editable, onNewVersion, onTrash }) {
  const detail = useSource(wid, sourceId);
  if (!sourceId) return <Empty>Select a document to see its details.</Empty>;
  if (detail.isPending) {
    return (
      <div className="pad stack" style={{ gap: 12 }} aria-busy="true">
        <Skeleton height={120} />
        <Skeleton width="60%" />
      </div>
    );
  }
  if (detail.error) return <Empty>This document is no longer available.</Empty>;
  const s = detail.data;
  const v = s.versions?.find((x) => x.id === s.currentVersionId) ?? s.versions?.[0];
  const state = s.ingestionState;
  const fileUrl = v ? `/api/workspaces/${wid}/sources/${s.id}/versions/${v.id}/file` : null;
  return (
    <div className="pad stack" style={{ gap: 16 }}>
      <div className="thumb" aria-hidden="true">
        {[90, 70, 84, 60, 88, 40].map((w, i) => (
          <i key={i} style={{ width: `${w}%` }} />
        ))}
      </div>
      <div>
        <h2 style={{ fontSize: 16, overflowWrap: 'anywhere' }}>{s.title}</h2>
        <div className="row" style={{ marginTop: 6 }}>
          <StatusBadge family="ingest" value={state} />
          {v && (
            <span className="mono subtle">
              v{v.versionNo}
              {v.versionNo > 1 ? ` · ${v.versionNo - 1} earlier` : ''}
            </span>
          )}
        </div>
        <div style={{ marginTop: 8 }}>
          <StageTrack state={state} labels />
        </div>
      </div>
      {state === 'QUARANTINED' && (
        <Callout tone="bad">This file was blocked by the safety scan and cannot be opened or downloaded.</Callout>
      )}
      {v?.ingestionError && <Callout tone={state === 'PARTIAL' ? 'warn' : 'bad'}>{v.ingestionError}</Callout>}
      {state === 'PREVIEW_READY' && <Callout tone="warn">Readable now. AI indexing continues in the background.</Callout>}
      <KeyValue
        items={[
          ['Type', fileType(s)],
          ['Pages', v?.pageCount ?? '—'],
          ['Size', formatBytes(v?.sizeBytes)],
          ['Updated', relativeTime(s.updatedAt)],
          ['Content hash', <span className="mono" key="h">{v ? `sha256:${v.sha256.slice(0, 12)}…` : '—'}</span>],
        ]}
      />
      <div className="row">
        <Link className="btn primary" to={`/app/knowledge/projects/${projectId}/documents/${s.id}`}>
          Open
        </Link>
        {fileUrl && state !== 'QUARANTINED' && (
          <a className="btn" href={fileUrl} download>
            <Icon name="download" size={16} />
            Download
          </a>
        )}
      </div>
      {editable && (
        <div className="row">
          <Button size="sm" onClick={onNewVersion}>
            <Icon name="upload" size={14} />
            Upload new version
          </Button>
          <Button size="sm" variant="ghost" onClick={onTrash}>
            <Icon name="trash" size={14} />
            Move to trash
          </Button>
        </div>
      )}
      {s.versions?.length > 1 && (
        <section aria-labelledby="h-versions">
          <h3 className="sect-h" id="h-versions">
            Versions
          </h3>
          <ul className="list">
            {s.versions.map((x) => (
              <li key={x.id} className="li" style={{ alignItems: 'center' }}>
                <span className="mono">v{x.versionNo}</span>
                <span className="grow subtle" style={{ fontSize: 12 }}>
                  {formatBytes(x.sizeBytes)} · {relativeTime(x.createdAt)}
                </span>
                <StatusBadge family="ingest" value={x.ingestionState} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Tray({ sources, editable, onRetry }) {
  const items = sources.filter((s) => BUSY_INGEST.has(s.ingestionState) || ATTENTION.has(s.ingestionState));
  if (items.length === 0) return <Empty>Nothing processing. Uploaded documents appear here with stage-by-stage progress.</Empty>;
  return (
    <ul className="list" aria-label="Ingestion pipeline">
      {items.map((s) => (
        <li key={s.id} className="li">
          <span className="ft" data-t={fileType(s)}>
            {fileType(s)}
          </span>
          <div className="grow">
            <div className="row between">
              <b style={{ fontWeight: 550 }}>{s.title}</b>
              <StatusBadge family="ingest" value={s.ingestionState} />
            </div>
            <StageTrack state={s.ingestionState} labels />
            <p className="subtle" style={{ fontSize: 12, marginTop: 4 }}>
              {s.currentVersion?.ingestionError || stateOf('ingest', s.ingestionState)?.description}
            </p>
          </div>
          {editable && s.ingestionState === 'FAILED' && s.currentVersionId && (
            <Button size="sm" onClick={() => onRetry(s)}>
              Retry
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ProjectPage() {
  const { projectId } = useParams();
  const ws = useCurrentWorkspace();
  const wid = ws?.id;
  const qc = useQueryClient();
  const project = useProject(wid, projectId);
  const projects = useProjects(wid);
  const foldersQ = useFolders(wid, projectId);
  const sourcesQ = useSources(wid, projectId);
  const editable = can(ws, 'EDITOR');

  const [folder, setFolder] = useState('all');
  const [open, setOpen] = useState(() => new Set());
  const [q, setQ] = useState('');
  const [type, setType] = useState('All');
  const [selected, setSelected] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const [dialog, setDialog] = useState(null);

  const folders = useMemo(() => foldersQ.data ?? [], [foldersQ.data]);
  const sources = useMemo(() => sourcesQ.data ?? [], [sourcesQ.data]);
  const tree = useMemo(() => folderTree(folders), [folders]);
  const counts = useMemo(() => {
    const m = new Map();
    for (const f of folders) {
      const scope = folderScope(folders, f.id);
      m.set(f.id, sources.filter((s) => s.folderId && scope.has(s.folderId)).length);
    }
    return m;
  }, [folders, sources]);
  const visible = useMemo(() => {
    const scope = folder === 'all' ? null : folderScope(folders, folder);
    const needle = q.trim().toLowerCase();
    return sources.filter(
      (s) =>
        (!scope || (s.folderId && scope.has(s.folderId))) &&
        (type === 'All' || fileType(s) === type) &&
        (!needle || s.title.toLowerCase().includes(needle)),
    );
  }, [sources, folders, folder, q, type]);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.sources(wid, projectId) }),
      qc.invalidateQueries({ queryKey: keys.folders(wid, projectId) }),
      qc.invalidateQueries({ queryKey: keys.trash(wid) }),
      qc.invalidateQueries({ queryKey: keys.projects(wid) }),
    ]);

  const batch = useMutation({
    mutationFn: (body) => api(`/workspaces/${wid}/sources/batch`, { method: 'POST', body }),
    onSuccess: async (res, body) => {
      await refresh();
      setChecked(new Set());
      const verb = { delete: 'moved to trash', move: 'moved', reingest: 'queued for processing' }[body.action];
      toast(`${res.affected} document${res.affected === 1 ? '' : 's'} ${verb}.`, 'ok');
    },
    onError: (e) => toast(e.message, 'bad'),
  });

  const retry = useMutation({
    mutationFn: (s) => api(`/workspaces/${wid}/sources/${s.id}/versions/${s.currentVersionId}/ingest`, { method: 'POST' }),
    onSuccess: async () => {
      await refresh();
      toast('Retry queued.', 'ai');
    },
    onError: (e) => toast(e.message, 'bad'),
  });

  if (project.error?.status === 404) {
    return (
      <section className="page">
        <h1>Project not found</h1>
        <p className="lede">This project does not exist in the current workspace, or it was moved to trash.</p>
        <Link to="/app/knowledge">Back to Folio Knowledge</Link>
      </section>
    );
  }

  const p = project.data;
  const currentFolder = folders.find((f) => f.id === folder);
  const others = (projects.data ?? []).filter((x) => x.kind === 'KNOWLEDGE' && x.id !== projectId);
  const toggleCheck = (id) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allChecked = visible.length > 0 && visible.every((s) => checked.has(s.id));

  return (
    <div className="panes k-panes">
      <aside className="ctx" aria-label="Project navigation">
        <p className="eyebrow" style={{ padding: '4px 8px' }}>
          Workspace
        </p>
        <WorkspaceSwitcher />
        <p className="eyebrow" style={{ padding: '14px 8px 4px' }}>
          {p?.name ?? 'Project'}
        </p>
        <ul className="tree" aria-label="Folders">
          <li>
            <button type="button" className="tnode" aria-current={folder === 'all'} onClick={() => setFolder('all')}>
              <span style={{ width: 13 }} />
              <Icon name="knowledge" size={15} />
              <span className="grow">All documents</span>
              <span className="mono subtle">{sources.length}</span>
            </button>
          </li>
          {tree.map((n) => (
            <TreeNode
              key={n.id}
              node={n}
              depth={0}
              selected={folder}
              open={open}
              counts={counts}
              onSelect={setFolder}
              onToggle={(id) =>
                setOpen((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
            />
          ))}
        </ul>
        {others.length > 0 && (
          <>
            <p className="eyebrow" style={{ padding: '14px 8px 4px' }}>
              Other projects
            </p>
            {others.map((o) => (
              <Link key={o.id} className="tnode" to={`/app/knowledge/projects/${o.id}`}>
                <Icon name="knowledge" size={15} />
                {o.name}
              </Link>
            ))}
          </>
        )}
        <Link className="tnode" to="/app/knowledge/trash" style={{ marginTop: 14 }}>
          <Icon name="trash" size={15} />
          Trash
        </Link>
      </aside>

      <section className="pane">
        <div className="page" style={{ maxWidth: 'none' }}>
          <div className="row between" style={{ marginBottom: 16, alignItems: 'flex-end' }}>
            <div>
              <p className="eyebrow">Folio Knowledge · Research project</p>
              <h1>{p?.name ?? <Skeleton width={220} height={28} />}</h1>
              {p?.description && (
                <p className="muted" style={{ marginTop: 4 }}>
                  {p.description}
                </p>
              )}
            </div>
            {editable && (
              <div className="row">
                {currentFolder && (
                  <DropdownMenu
                    trigger={
                      <Button aria-label={`Folder actions for ${currentFolder.name}`}>
                        <Icon name="more" size={16} />
                      </Button>
                    }
                    items={[
                      { label: 'Rename folder', onSelect: () => setDialog({ kind: 'rename-folder', folder: currentFolder }) },
                      { label: 'Delete folder', danger: true, onSelect: () => setDialog({ kind: 'delete-folder', folder: currentFolder }) },
                    ]}
                  />
                )}
                <Button onClick={() => setDialog({ kind: 'new-folder' })}>
                  <Icon name="folder" size={16} />
                  New folder
                </Button>
                <Button variant="primary" onClick={() => setDialog({ kind: 'upload' })}>
                  <Icon name="upload" size={16} />
                  Upload
                </Button>
              </div>
            )}
          </div>

          <div className="row" style={{ marginBottom: 12 }}>
            <label className="sr" htmlFor="kq">
              Filter documents by name
            </label>
            <Input id="kq" style={{ maxWidth: 260 }} placeholder="Filter by name…" value={q} onChange={(e) => setQ(e.target.value)} />
            <Segmented label="File type" options={TYPES.map((t) => ({ value: t, label: t }))} value={type} onChange={setType} />
            <span className="grow" />
            <span className="subtle" aria-live="polite">
              {visible.length} of {sources.length}
            </span>
          </div>

          {checked.size > 0 && editable && (
            <div className="batch" role="region" aria-label="Batch actions">
              <b>{checked.size} selected</b>
              <Button size="sm" onClick={() => setDialog({ kind: 'move' })}>
                Move
              </Button>
              <Button size="sm" onClick={() => batch.mutate({ action: 'reingest', ids: [...checked] })}>
                Reprocess
              </Button>
              <Button size="sm" onClick={() => batch.mutate({ action: 'delete', ids: [...checked] })}>
                Move to trash
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>
                Clear
              </Button>
            </div>
          )}

          <div className="card" style={{ overflow: 'auto' }}>
            <table className="table">
              <caption className="sr">Documents in {p?.name ?? 'this project'}</caption>
              <thead>
                <tr>
                  <th scope="col">
                    {editable ? (
                      <input
                        type="checkbox"
                        aria-label="Select all shown documents"
                        checked={allChecked}
                        onChange={() => setChecked(allChecked ? new Set() : new Set(visible.map((s) => s.id)))}
                      />
                    ) : (
                      <span className="sr">Select</span>
                    )}
                  </th>
                  <th scope="col">Name</th>
                  <th scope="col">Version</th>
                  <th scope="col">Processing</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {sourcesQ.isPending ? (
                  <tr>
                    <td colSpan={5}>
                      <Skeleton />
                    </td>
                  </tr>
                ) : visible.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      {sources.length === 0 ? (
                        <Empty>No documents yet. {editable ? 'Upload PDF, DOCX, Markdown, text or EPUB files to get started.' : ''}</Empty>
                      ) : (
                        <Empty>
                          No documents match.{' '}
                          <Button
                            size="sm"
                            onClick={() => {
                              setQ('');
                              setType('All');
                              setFolder('all');
                            }}
                          >
                            Clear filters
                          </Button>
                        </Empty>
                      )}
                    </td>
                  </tr>
                ) : (
                  visible.map((s) => (
                    <tr key={s.id} className={selected === s.id ? 'sel' : undefined} onClick={() => setSelected(s.id)}>
                      <td onClick={(e) => e.stopPropagation()}>
                        {editable && (
                          <input type="checkbox" aria-label={`Select ${s.title}`} checked={checked.has(s.id)} onChange={() => toggleCheck(s.id)} />
                        )}
                      </td>
                      <td>
                        <button type="button" className="linkish" onClick={() => setSelected(s.id)} aria-pressed={selected === s.id}>
                          <span className="ft" data-t={fileType(s)}>
                            {fileType(s)}
                          </span>
                          {s.title}
                        </button>
                      </td>
                      <td className="mono">v{s.currentVersion?.versionNo ?? 1}</td>
                      <td>
                        <StatusBadge family="ingest" value={s.ingestionState} />
                      </td>
                      <td className="subtle">{relativeTime(s.updatedAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <h2 className="sect-h" style={{ marginTop: 28 }}>
            Ingestion pipeline
          </h2>
          <Tray sources={sources} editable={editable} onRetry={(s) => retry.mutate(s)} />
        </div>
      </section>

      <aside className="side" aria-label="Document details">
        <Preview
          wid={wid}
          projectId={projectId}
          sourceId={selected}
          editable={editable}
          onNewVersion={() => setDialog({ kind: 'version', source: sources.find((s) => s.id === selected) })}
          onTrash={() => {
            batch.mutate({ action: 'delete', ids: [selected] });
            setSelected(null);
          }}
        />
      </aside>

      <UploadDialog
        open={dialog?.kind === 'upload' || dialog?.kind === 'version'}
        onOpenChange={(o) => !o && setDialog(null)}
        workspaceId={wid}
        projectId={projectId}
        folders={folders}
        defaultFolderId={currentFolder?.id ?? null}
        source={dialog?.kind === 'version' ? dialog.source : null}
        key={dialog?.kind === 'version' ? `v-${dialog.source?.id}` : `u-${currentFolder?.id ?? 'root'}`}
      />
      <NewFolderDialog
        key={dialog?.kind === 'new-folder' ? 'nf-open' : 'nf'}
        open={dialog?.kind === 'new-folder'}
        onOpenChange={(o) => !o && setDialog(null)}
        folders={folders}
        defaultParentId={currentFolder?.id}
        onSubmit={async (body) => {
          await api(`/workspaces/${wid}/projects/${projectId}/folders`, { method: 'POST', body });
          await refresh();
        }}
      />
      {dialog?.kind === 'rename-folder' && (
        <NameDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title="Rename folder"
          label="Folder name"
          initial={dialog.folder.name}
          onSubmit={async (name) => {
            await api(`/workspaces/${wid}/folders/${dialog.folder.id}`, { method: 'PATCH', body: { name } });
            await refresh();
          }}
        />
      )}
      {dialog?.kind === 'delete-folder' && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          title={`Delete ${dialog.folder.name}?`}
          confirmLabel="Delete folder"
          onConfirm={async () => {
            await api(`/workspaces/${wid}/folders/${dialog.folder.id}`, { method: 'DELETE' });
            setFolder('all');
            await refresh();
          }}
        >
          The folder, its subfolders and their documents move to Trash. They can be restored for 30 days.
        </ConfirmDialog>
      )}
      {dialog?.kind === 'move' && (
        <MoveDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          folders={folders}
          count={checked.size}
          onSubmit={(folderId) => batch.mutateAsync({ action: 'move', ids: [...checked], folderId })}
        />
      )}
    </div>
  );
}
