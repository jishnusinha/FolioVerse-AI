import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, uploadWithProgress } from '@/api/client.js';
import { Badge, Button, Dialog, Field, Progress, Select, StatusBadge } from '@/shared/ui/index.js';
import { Icon } from '@/shared/icons.jsx';
import { ACCEPT_ATTR, ALLOWED_EXTENSIONS, extensionOf, formatBytes, isAllowedFile } from './files.js';
import { keys } from './queries.js';

let seq = 0;
const LOCAL = {
  QUEUED: { tone: 'neutral', glyph: '○', label: 'Queued' },
  REJECTED: { tone: 'bad', glyph: '×', label: 'Not allowed' },
  CANCELLED: { tone: 'neutral', glyph: '–', label: 'Cancelled' },
};
const DONE = new Set(['PREVIEW_READY', 'QUARANTINED', 'FAILED', 'REJECTED', 'CANCELLED']);

function ItemState({ item }) {
  const local = LOCAL[item.status];
  return local ? (
    <Badge tone={local.tone} glyph={local.glyph}>
      {local.label}
    </Badge>
  ) : (
    <StatusBadge family="ingest" value={item.status} />
  );
}

/**
 * Upload one or more files into a project, or a new version of an existing source.
 * Each file: create session → PUT bytes (with progress) → complete (size, hash and type checks) → PREVIEW_READY or QUARANTINED.
 */
export function UploadDialog({ open, onOpenChange, workspaceId, projectId, folders = [], defaultFolderId = null, source = null }) {
  const qc = useQueryClient();
  const [items, setItems] = useState([]);
  const [folderId, setFolderId] = useState(defaultFolderId ?? '');
  const [running, setRunning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const abortRef = useRef(null);
  const inputRef = useRef(null);
  const versionMode = Boolean(source);

  const patch = (key, p) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...p } : it)));

  function addFiles(fileList) {
    const files = [...fileList].slice(0, versionMode ? 1 : 50);
    const next = files.map((file) => ({
      key: `f${++seq}`,
      file,
      status: isAllowedFile(file.name) ? 'QUEUED' : 'REJECTED',
      pct: 0,
      error: isAllowedFile(file.name) ? null : `.${extensionOf(file.name) || '?'} files are not supported`,
    }));
    setItems((list) => (versionMode ? next : [...list.filter((i) => !DONE.has(i.status) || i.status === 'PREVIEW_READY'), ...next]));
  }

  async function uploadOne(item, signal) {
    patch(item.key, { status: 'UPLOADING', pct: 0, error: null });
    const session = await api(`/workspaces/${workspaceId}/uploads`, {
      method: 'POST',
      body: {
        projectId,
        filename: item.file.name,
        sizeBytes: item.file.size,
        ...(folderId && !versionMode ? { folderId } : {}),
        ...(versionMode ? { sourceId: source.id } : {}),
      },
      signal,
    });
    await uploadWithProgress(session, item.file, { signal, onProgress: (pct) => patch(item.key, { pct }) });
    patch(item.key, { status: 'SCANNING', pct: 100 });
    const done = await api(`/workspaces/${workspaceId}/uploads/${session.uploadId}/complete`, { method: 'POST', body: {}, signal });
    patch(item.key, {
      status: done.state,
      sourceId: done.sourceId,
      error: done.state === 'QUARANTINED' ? `Blocked by the safety scan${done.reason ? `: ${done.reason}` : ''}.` : null,
    });
  }

  async function start() {
    setRunning(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    for (const item of items.filter((i) => i.status === 'QUEUED' || i.status === 'FAILED')) {
      if (ctrl.signal.aborted) {
        patch(item.key, { status: 'CANCELLED' });
        continue;
      }
      try {
        await uploadOne(item, ctrl.signal);
      } catch (err) {
        patch(item.key, ctrl.signal.aborted ? { status: 'CANCELLED', error: null } : { status: 'FAILED', error: err.message });
      }
    }
    abortRef.current = null;
    setRunning(false);
    qc.invalidateQueries({ queryKey: keys.sources(workspaceId, projectId) });
    qc.invalidateQueries({ queryKey: keys.projects(workspaceId) });
    if (source) qc.invalidateQueries({ queryKey: keys.source(workspaceId, source.id) });
  }

  function close(next) {
    if (!next && running) abortRef.current?.abort();
    if (!next) setItems((list) => list.filter((i) => !DONE.has(i.status)));
    onOpenChange(next);
  }

  const pending = items.filter((i) => i.status === 'QUEUED' || i.status === 'FAILED').length;

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={versionMode ? `Upload a new version of ${source.title}` : 'Upload documents'}
      description={`Allowed: ${ALLOWED_EXTENSIONS.map((e) => e.toUpperCase()).join(', ')}. Files are scanned before anything else happens.`}
      footer={
        <>
          {running ? (
            <Button onClick={() => abortRef.current?.abort()}>Cancel uploads</Button>
          ) : (
            <Button onClick={() => close(false)}>Close</Button>
          )}
          <Button variant="primary" onClick={start} disabled={running || pending === 0}>
            {running ? 'Uploading…' : pending > 1 ? `Upload ${pending} files` : 'Upload'}
          </Button>
        </>
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        {!versionMode && folders.length > 0 && (
          <Field label="Destination folder">
            <Select value={folderId} onChange={(e) => setFolderId(e.target.value)} disabled={running}>
              <option value="">Project root</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div
          className="dropzone"
          data-active={dragging || undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!running) addFiles(e.dataTransfer.files);
          }}
        >
          <Icon name="upload" size={22} />
          <p>
            Drag {versionMode ? 'a file' : 'files'} here or{' '}
            <button type="button" className="linkish" onClick={() => inputRef.current?.click()} disabled={running}>
              choose {versionMode ? 'a file' : 'files'}
            </button>
          </p>
          <input
            ref={inputRef}
            type="file"
            className="sr"
            aria-label={versionMode ? 'Choose a file' : 'Choose files'}
            accept={ACCEPT_ATTR}
            multiple={!versionMode}
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        {items.length > 0 && (
          <ul className="list" aria-label="Files to upload">
            {items.map((it) => (
              <li key={it.key} className="li" data-status={it.status}>
                <span className="ft" data-t={extensionOf(it.file.name).toUpperCase()}>
                  {extensionOf(it.file.name).toUpperCase() || '?'}
                </span>
                <div className="grow stack" style={{ gap: 6, minWidth: 0 }}>
                  <div className="row between" style={{ flexWrap: 'nowrap' }}>
                    <b style={{ fontWeight: 550, overflowWrap: 'anywhere' }}>{it.file.name}</b>
                    <ItemState item={it} />
                  </div>
                  {it.status === 'UPLOADING' && <Progress value={it.pct} label={`Uploading ${it.file.name}`} />}
                  <p className="subtle" style={{ fontSize: 12 }}>
                    {it.error ?? `${formatBytes(it.file.size)}${it.status === 'PREVIEW_READY' ? ' · readable now; indexing continues in the background' : ''}`}
                  </p>
                </div>
                {!running && !DONE.has(it.status) && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove ${it.file.name}`}
                    onClick={() => setItems((list) => list.filter((x) => x.key !== it.key))}
                  >
                    <Icon name="x" size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
