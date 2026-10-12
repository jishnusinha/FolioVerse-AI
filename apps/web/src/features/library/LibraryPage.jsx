import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { can, useCurrentWorkspace } from '@/features/auth/session.js';
import { useProjects } from '@/features/knowledge/queries.js';
import { UploadDialog } from '@/features/knowledge/UploadDialog.jsx';
import { relativeTime } from '@/features/knowledge/files.js';
import { Icon } from '@/shared/icons.jsx';
import { Panes } from '@/shared/layout/Panes.jsx';
import { Button, Callout, DemoBadge, DropdownMenu, Empty, IconButton, Input, Progress, Segmented, Skeleton, StatusBadge, toast } from '@/shared/ui/index.js';
import { AddBookDialog } from './AddBookDialog.jsx';
import { Cover } from './Cover.jsx';
import { STATUSES, STATUS_LABEL, libraryApi, libraryKeys, useCollections, useLibraryItems, useLibraryStats } from './queries.js';

const readerPath = (item) => `/app/library/books/${item.id}/read`;
const pct = (item) => Math.round((item.progress?.percent ?? 0) * 100);
const authors = (b) => (b.authors?.length ? b.authors.join(', ') : 'Unknown author');
const readable = (item) => Boolean(item.sourceId) && ['READY', 'PARTIAL'].includes(item.source?.ingestionState);

function progressLabel(item) {
  if (item.status === 'FINISHED') return 'Finished';
  if (item.status === 'ABANDONED') return item.progress ? `Set aside at ${pct(item)}%` : 'Set aside';
  if (item.sourceId && item.source && !readable(item)) return 'Preparing file…';
  return item.progress ? `${pct(item)}% read` : 'Not started';
}

function minutes(seconds) {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

function Shelves({ items, status, setStatus, collections, collectionId, setCollectionId, onNewCollection, onRemoveCollection }) {
  const count = (k) => items.filter((i) => !k || i.status === k).length;
  const shelves = [['', 'All books'], ...STATUSES];
  return (
    <>
      <p className="eyebrow" style={{ padding: '4px 8px' }}>
        Shelves
      </p>
      <ul className="tree" aria-label="Shelves">
        {shelves.map(([k, label]) => (
          <li key={k || 'all'}>
            <button
              type="button"
              className="tnode"
              aria-current={!collectionId && status === k}
              onClick={() => {
                setCollectionId('');
                setStatus(k);
              }}
            >
              <Icon name="library" size={14} />
              <span className="grow">{label}</span>
              <span className="mono subtle">{count(k)}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="row between" style={{ padding: '14px 8px 4px' }}>
        <p className="eyebrow">Collections</p>
        <IconButton label="New collection" onClick={onNewCollection}>
          <Icon name="plus" size={14} />
        </IconButton>
      </div>
      <ul className="tree" aria-label="Collections">
        {(collections ?? []).map((c) => (
          <li key={c.id} className="row" style={{ flexWrap: 'nowrap', gap: 0 }}>
            <button
              type="button"
              className="tnode grow"
              aria-current={collectionId === c.id}
              onClick={() => {
                setStatus('');
                setCollectionId(c.id);
              }}
            >
              <span className="grow">{c.name}</span>
              <span className="mono subtle">{c.itemCount}</span>
            </button>
            <DropdownMenu
              trigger={
                <button type="button" className="icon-btn" aria-label={`Collection actions: ${c.name}`}>
                  <Icon name="more" size={14} />
                </button>
              }
              items={[{ label: 'Delete collection', danger: true, onSelect: () => onRemoveCollection(c) }]}
            />
          </li>
        ))}
        {collections?.length === 0 && <li className="subtle" style={{ padding: '4px 8px', fontSize: 12 }}>Group books by theme or project.</li>}
      </ul>
    </>
  );
}

function ItemMenu({ item, collections, onStatus, onToggleCollection, onRemove }) {
  return (
    <DropdownMenu
      trigger={
        <button type="button" className="icon-btn" aria-label={`Actions for ${item.book.title}`}>
          <Icon name="more" size={16} />
        </button>
      }
      items={[
        ...STATUSES.filter(([k]) => k !== item.status).map(([k, label]) => ({ label: `Move to ${label}`, onSelect: () => onStatus(item, k) })),
        ...(collections?.length ? ['-'] : []),
        ...(collections ?? []).map((c) => {
          const inside = item.collectionIds?.includes(c.id);
          return { label: `${inside ? 'Remove from' : 'Add to'} ${c.name}`, onSelect: () => onToggleCollection(item, c, inside) };
        }),
        '-',
        { label: 'Remove from library', danger: true, onSelect: () => onRemove(item) },
      ]}
    />
  );
}

function Rating({ item, onRate }) {
  return (
    <span className="row" role="group" aria-label={`Rating for ${item.book.title}`} style={{ gap: 0 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className="icon-btn"
          style={{ width: 22, height: 22, color: n <= (item.rating ?? 0) ? 'var(--fv-warn)' : 'var(--fv-border-strong)' }}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          aria-pressed={n <= (item.rating ?? 0)}
          onClick={() => onRate(item, item.rating === n ? 0 : n)}
        >
          ★
        </button>
      ))}
    </span>
  );
}

function Activity({ stats }) {
  if (!stats) return <Skeleton height={80} />;
  const max = Math.max(1, ...stats.activity.map((a) => a.seconds));
  return (
    <>
      <div
        style={{ display: 'grid', gridTemplateColumns: `repeat(${stats.activity.length},1fr)`, gap: 4 }}
        role="img"
        aria-label={`Read on ${stats.daysRead} of the last ${stats.activity.length} days`}
      >
        {stats.activity.map((a) => (
          <span
            key={a.day}
            title={`${a.day}: ${minutes(a.seconds)}`}
            style={{ aspectRatio: '1', borderRadius: 3, background: a.seconds ? 'var(--fv-accent)' : 'var(--fv-sunken)', opacity: a.seconds ? 0.35 + (0.65 * a.seconds) / max : 1 }}
          />
        ))}
      </div>
      <p className="subtle" style={{ marginTop: 10, fontSize: 12 }}>
        {stats.daysRead} of {stats.activity.length} days{stats.streak > 1 ? ` · ${stats.streak}-day streak` : ''} · {minutes(stats.totalSeconds)} in total
      </p>
    </>
  );
}

export function LibraryPage() {
  const ws = useCurrentWorkspace();
  const wid = ws?.id;
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState('grid');
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const all = useLibraryItems(wid);
  const collections = useCollections(wid);
  const stats = useLibraryStats(wid);
  const projects = useProjects(wid);
  const libraryProject = projects.data?.find((p) => p.kind === 'LIBRARY');
  const canUpload = Boolean(libraryProject) && can(ws, 'EDITOR');

  const items = useMemo(() => all.data ?? [], [all.data]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter(
      (i) =>
        (!status || i.status === status) &&
        (!collectionId || i.collectionIds?.includes(collectionId)) &&
        (!needle || i.book.title.toLowerCase().includes(needle) || i.book.authors?.some((a) => a.toLowerCase().includes(needle))),
    );
  }, [items, status, collectionId, q]);
  const current = items.filter((i) => i.status === 'READING').sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''))[0];
  const heading = collectionId ? (collections.data?.find((c) => c.id === collectionId)?.name ?? 'Collection') : status ? STATUS_LABEL[status] : 'All books';

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: libraryKeys.allItems(wid) }),
      qc.invalidateQueries({ queryKey: libraryKeys.collections(wid) }),
      qc.invalidateQueries({ queryKey: libraryKeys.stats(wid) }),
    ]);
  const act = async (fn, done) => {
    try {
      await fn();
      await refresh();
      if (done) toast(done, 'ok');
    } catch (e) {
      toast(e.message || 'That did not work', 'bad');
    }
  };
  const onStatus = (item, s) => act(() => libraryApi.updateItem(wid, item.id, { status: s }), `${item.book.title} moved to ${STATUS_LABEL[s]}`);
  const onRate = (item, rating) => act(() => libraryApi.updateItem(wid, item.id, { rating }));
  const onToggleCollection = (item, c, inside) =>
    act(() => (inside ? libraryApi.removeFromCollection(wid, c.id, item.id) : libraryApi.addToCollection(wid, c.id, item.id)), inside ? `Removed from ${c.name}` : `Added to ${c.name}`);
  const onRemove = (item) => {
    if (!window.confirm(`Remove “${item.book.title}” from your library? Highlights, notes and progress for it are deleted. An uploaded file stays in the workspace.`)) return;
    act(() => libraryApi.removeItem(wid, item.id), 'Removed from library');
  };
  const onNewCollection = () => {
    const name = window.prompt('Collection name')?.trim();
    if (name) act(() => libraryApi.createCollection(wid, { name }), `Collection “${name}” created`);
  };
  const onRemoveCollection = (c) => {
    if (!window.confirm(`Delete the collection “${c.name}”? The books stay in your library.`)) return;
    if (collectionId === c.id) setCollectionId('');
    act(() => libraryApi.removeCollection(wid, c.id), 'Collection deleted');
  };

  return (
    <Panes
      className="lib-panes"
      columns="230px minmax(0,1fr)"
      contextLabel="Shelves"
      context={
        <Shelves
          items={items}
          status={status}
          setStatus={setStatus}
          collections={collections.data}
          collectionId={collectionId}
          setCollectionId={setCollectionId}
          onNewCollection={onNewCollection}
          onRemoveCollection={onRemoveCollection}
        />
      }
    >
      <div className="page">
        <header className="row between" style={{ alignItems: 'flex-end', marginBottom: 20 }}>
          <div>
            <p className="eyebrow">Personal reading library · private to you</p>
            <h1 style={{ font: '500 30px var(--fv-font-serif)' }}>Library</h1>
          </div>
          <div className="row">
            <Button onClick={() => setAdding(true)}>
              <Icon name="plus" size={16} />
              Add manually
            </Button>
            <Button variant="primary" onClick={() => setUploading(true)} disabled={!canUpload} title={canUpload ? undefined : 'Uploading needs a Library project and the Editor role'}>
              <Icon name="upload" size={16} />
              Upload book
            </Button>
          </div>
        </header>

        {all.isPending ? (
          <div className="stack" aria-busy="true" style={{ gap: 12 }}>
            <Skeleton height={180} />
            <Skeleton height={220} />
          </div>
        ) : all.error ? (
          <Callout tone="bad" role="alert">
            Your library could not be loaded: {all.error.message}
          </Callout>
        ) : (
          <>
            {current && !status && !collectionId && !q && (
              <section className="card pad row" aria-label="Currently reading" style={{ gap: 24, alignItems: 'flex-start', flexWrap: 'nowrap', marginBottom: 28 }}>
                <div style={{ width: 130, flexShrink: 0 }}>
                  <Cover book={current.book} to={readable(current) ? readerPath(current) : undefined} />
                </div>
                <div className="grow">
                  <p className="eyebrow">Currently reading</p>
                  <h2 style={{ font: '500 24px var(--fv-font-serif)', margin: '4px 0' }}>{current.book.title}</h2>
                  <p className="muted">
                    {authors(current.book)}
                    {current.progress?.locator?.title ? ` · ${current.progress.locator.title}` : ''}
                  </p>
                  <div style={{ margin: '14px 0 6px', maxWidth: 360 }}>
                    <Progress value={pct(current)} label={`${current.book.title}: ${pct(current)}% read`} />
                  </div>
                  <p className="subtle" style={{ fontSize: 12 }}>
                    {pct(current)}%{current.lastOpenedAt ? ` · last opened ${relativeTime(current.lastOpenedAt)}` : ''}
                  </p>
                  {readable(current) && (
                    <Link className="btn primary" to={readerPath(current)} style={{ marginTop: 14 }}>
                      Continue reading
                    </Link>
                  )}
                </div>
              </section>
            )}

            <div className="row between" style={{ marginBottom: 14 }}>
              <h2 className="sect-h" style={{ margin: 0 }}>
                {heading}
              </h2>
              <div className="row">
                <Input type="search" aria-label="Filter books" placeholder="Filter by title or author" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
                <Segmented
                  label="Layout"
                  value={view}
                  onChange={setView}
                  options={[
                    { value: 'grid', label: 'Grid' },
                    { value: 'list', label: 'List' },
                  ]}
                />
              </div>
            </div>

            {shown.length === 0 ? (
              <Empty>{items.length ? 'No books match.' : 'Your library is empty. Upload an EPUB or PDF to read it here, or add a book you are reading elsewhere.'}</Empty>
            ) : view === 'grid' ? (
              <div className="shelf" role="list" aria-label="Books">
                {shown.map((item) => (
                  <figure key={item.id} role="listitem">
                    <Cover book={item.book} to={readable(item) ? readerPath(item) : undefined} />
                    <figcaption className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                      <span>
                        <b>{item.book.title}</b>
                        <br />
                        <span className="subtle">{progressLabel(item)}</span>
                      </span>
                      <ItemMenu item={item} collections={collections.data} onStatus={onStatus} onToggleCollection={onToggleCollection} onRemove={onRemove} />
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <div style={{ overflow: 'auto' }}>
                <table className="table" aria-label="Books">
                  <thead>
                    <tr>
                      <th scope="col">Title</th>
                      <th scope="col">Shelf</th>
                      <th scope="col">Progress</th>
                      <th scope="col">Rating</th>
                      <th scope="col">
                        <span className="sr">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((item) => (
                      <tr key={item.id}>
                        <td>
                          {readable(item) ? <Link to={readerPath(item)}>{item.book.title}</Link> : <b style={{ fontWeight: 550 }}>{item.book.title}</b>}
                          <br />
                          <span className="subtle">{authors(item.book)}</span>
                          {item.book.isDemo && <DemoBadge />}
                        </td>
                        <td>{STATUS_LABEL[item.status]}</td>
                        <td>
                          {item.source && !readable(item) ? <StatusBadge family="ingest" value={item.source.ingestionState} /> : <span className="mono">{progressLabel(item)}</span>}
                        </td>
                        <td>
                          <Rating item={item} onRate={onRate} />
                        </td>
                        <td>
                          <ItemMenu item={item} collections={collections.data} onStatus={onStatus} onToggleCollection={onToggleCollection} onRemove={onRemove} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="dash" style={{ marginTop: 30 }}>
              <section className="card pad c-7" aria-labelledby="lib-activity">
                <h2 className="sect-h" id="lib-activity">
                  Reading activity · 14 days
                </h2>
                <Activity stats={stats.data} />
              </section>
              <section className="card pad c-5" aria-labelledby="lib-stats">
                <h2 className="sect-h" id="lib-stats">
                  This year
                </h2>
                {stats.data ? (
                  <dl className="kv">
                    <dt>Finished</dt>
                    <dd>{stats.data.finishedThisYear}</dd>
                    <dt>Reading now</dt>
                    <dd>{stats.data.counts.READING}</dd>
                    <dt>Highlights</dt>
                    <dd>{stats.data.highlights}</dd>
                    <dt>Notes</dt>
                    <dd>{stats.data.notes}</dd>
                  </dl>
                ) : (
                  <Skeleton height={80} />
                )}
              </section>
            </div>
          </>
        )}
      </div>

      <AddBookDialog open={adding} onOpenChange={setAdding} workspaceId={wid} 
        onSubmit={async (body) => {
          await libraryApi.createItem(wid, body);
          await refresh();
          toast('Book added', 'ok');
        }}
      />
      {libraryProject && (
        <UploadDialog
          open={uploading}
          onOpenChange={(o) => {
            setUploading(o);
            if (!o) refresh();
          }}
          workspaceId={wid}
          projectId={libraryProject.id}
          extensions={['epub', 'pdf']}
          title="Upload books"
          onUploaded={(done) => libraryApi.createItem(wid, { sourceId: done.sourceId })}
        />
      )}
    </Panes>
  );
}
