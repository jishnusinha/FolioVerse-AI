import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '@/shared/icons.jsx';
import { Button, Dialog, DropdownMenu, Field, IconButton, Input } from '@/shared/ui/index.js';
import { writerApi, writerKeys } from './queries.js';

const CHILD = { PART: 'CHAPTER', CHAPTER: 'SCENE' };
const NOUN = { PART: 'part', CHAPTER: 'chapter', SCENE: 'scene' };

/** Children of `parentId` in outline order. */
export const childrenOf = (nodes, parentId) => nodes.filter((n) => (n.parentId ?? null) === parentId).sort((a, b) => a.position - b.position);

/** Scenes in reading order (depth-first). */
export function scenesInOrder(nodes) {
  const out = [];
  const walk = (pid) => {
    for (const n of childrenOf(nodes, pid)) {
      if (n.kind === 'SCENE') out.push(n);
      else walk(n.id);
    }
  };
  walk(null);
  return out;
}

/**
 * Manuscript structure: parts → chapters → scenes, with word counts. Editors can add, rename, reorder and delete.
 * @param {{ wid: string, manuscript: any, sceneId: string | null, onSelect: (id: string) => void, editable: boolean }} props
 */
export function OutlineTree({ wid, manuscript, sceneId, onSelect, editable }) {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState(/** @type {any} */ (null));
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const nodes = manuscript.nodes;
  const refresh = () => qc.invalidateQueries({ queryKey: writerKeys.manuscript(wid, manuscript.id) });

  const run = async (fn) => {
    try {
      await fn();
      await refresh();
      setDialog(null);
    } catch (err) {
      setError(err.message);
    }
  };

  const open = (d) => {
    setDialog(d);
    setName(d.mode === 'rename' ? d.node.title : '');
    setError('');
  };

  function submit(e) {
    e.preventDefault();
    const title = name.trim();
    if (dialog.mode !== 'delete' && !title) return setError('Give it a title.');
    run(async () => {
      if (dialog.mode === 'rename') await writerApi.updateNode(wid, manuscript.id, dialog.node.id, { title });
      else if (dialog.mode === 'delete') {
        await writerApi.deleteNode(wid, manuscript.id, dialog.node.id);
        if (dialog.node.id === sceneId || nodes.some((n) => n.id === sceneId && isUnder(nodes, n, dialog.node.id))) onSelect(null);
      } else {
        const created = await writerApi.createNode(wid, manuscript.id, { kind: dialog.kind, title, parentId: dialog.parentId ?? undefined });
        if (created.kind === 'SCENE') onSelect(created.id);
      }
    });
  }

  const move = (n, delta) => run(() => writerApi.updateNode(wid, manuscript.id, n.id, { position: Math.max(0, n.position + delta) }));

  const menu = (n) => {
    const sibs = childrenOf(nodes, n.parentId ?? null);
    const i = sibs.findIndex((s) => s.id === n.id);
    return (
      <DropdownMenu
        trigger={
          <IconButton label={`Actions for ${n.title}`} className="w-tree-more">
            <Icon name="more" size={14} />
          </IconButton>
        }
        items={[
          ...(CHILD[n.kind] ? [{ label: `Add ${NOUN[CHILD[n.kind]]}`, onSelect: () => open({ mode: 'create', kind: CHILD[n.kind], parentId: n.id }) }] : []),
          { label: 'Rename', onSelect: () => open({ mode: 'rename', node: n }) },
          { label: 'Move up', disabled: i <= 0, onSelect: () => move(n, -1) },
          { label: 'Move down', disabled: i >= sibs.length - 1, onSelect: () => move(n, 1) },
          '-',
          { label: `Delete ${NOUN[n.kind]}`, danger: true, onSelect: () => open({ mode: 'delete', node: n }) },
        ]}
      />
    );
  };

  const scene = (s, label) => (
    <li key={s.id} className="w-tree-row">
      <button type="button" className="tnode" aria-current={s.id === sceneId} onClick={() => onSelect(s.id)}>
        <span className="grow">{label ?? s.title}</span>
        <span className="mono subtle">{s.wordCount ? s.wordCount.toLocaleString() : '—'}</span>
      </button>
      {editable && menu(s)}
    </li>
  );

  const chapter = (c) => (
    <li key={c.id}>
      <div className="w-tree-row">
        <span className="tnode w-tree-h">{c.title}</span>
        {editable && menu(c)}
      </div>
      <ul>{childrenOf(nodes, c.id).map((s) => scene(s))}</ul>
    </li>
  );

  return (
    <nav aria-label="Manuscript structure" className="w-tree">
      <p className="eyebrow" style={{ padding: '4px 8px' }}>
        {manuscript.title}
      </p>
      {childrenOf(nodes, null).map((top) =>
        top.kind === 'PART' ? (
          <section key={top.id}>
            <div className="w-tree-row">
              <p className="subtle w-tree-part">{top.title}</p>
              {editable && menu(top)}
            </div>
            <ul className="tree">{childrenOf(nodes, top.id).map(chapter)}</ul>
          </section>
        ) : (
          <ul key={top.id} className="tree">
            {chapter(top)}
          </ul>
        ),
      )}
      {editable && (
        <Button size="sm" variant="ghost" style={{ margin: '8px 4px' }} onClick={() => open({ mode: 'create', kind: 'PART', parentId: null })}>
          <Icon name="plus" size={14} />
          Add part
        </Button>
      )}
      <Dialog
        open={Boolean(dialog)}
        onOpenChange={(o) => !o && setDialog(null)}
        title={
          !dialog ? '' : dialog.mode === 'rename' ? `Rename ${NOUN[dialog.node.kind]}` : dialog.mode === 'delete' ? `Delete “${dialog.node.title}”?` : `New ${NOUN[dialog.kind]}`
        }
        description={dialog?.mode === 'delete' ? 'Everything inside it is deleted too, with its scenes, revisions, suggestions and continuity issues.' : undefined}
        footer={
          <>
            <Button onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant={dialog?.mode === 'delete' ? 'danger' : 'primary'} type="submit" form="outline-form">
              {dialog?.mode === 'delete' ? 'Delete' : dialog?.mode === 'rename' ? 'Rename' : 'Add'}
            </Button>
          </>
        }
      >
        <form id="outline-form" onSubmit={submit}>
          {dialog?.mode !== 'delete' ? (
            <Field label="Title" error={error || undefined}>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus />
            </Field>
          ) : (
            error && (
              <p role="alert" className="muted">
                {error}
              </p>
            )
          )}
        </form>
      </Dialog>
    </nav>
  );
}

function isUnder(nodes, n, ancestorId) {
  let p = n.parentId;
  while (p) {
    if (p === ancestorId) return true;
    p = nodes.find((x) => x.id === p)?.parentId ?? null;
  }
  return false;
}
