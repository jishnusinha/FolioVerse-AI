import { useMemo } from 'react';
import { Background, Controls, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/base.css';

const W = 140;
const H = 44;

/**
 * Entities on an ellipse (relationship graphs have no natural direction), links as edges. Proposed links are
 * dashed; retired ones are left out.
 * @param {{ name: string, kind: string, proposed: boolean }[]} entities
 * @param {{ id: string, source: string, target: string, label: string, status: string, weight: number }[]} links
 */
export function layoutStory(entities, links, selected) {
  const n = entities.length;
  const rx = Math.max(160, n * 34);
  const ry = Math.max(110, n * 22);
  const names = new Set(entities.map((e) => e.name));
  return {
    nodes: entities.map((e, i) => {
      const a = (2 * Math.PI * i) / Math.max(1, n) - Math.PI / 2;
      return {
        id: e.name,
        position: { x: rx + rx * Math.cos(a) - W / 2, y: ry + ry * Math.sin(a) - H / 2 },
        data: { label: e.name },
        className: `sg-node${e.proposed ? ' proposed' : ''}${selected === e.name ? ' selected' : ''}`,
        style: { width: W },
        draggable: false,
        ariaLabel: `${e.name}, ${e.kind.toLowerCase()}${e.proposed ? ', proposed' : ''}`,
      };
    }),
    edges: links
      .filter((l) => l.status !== 'RETIRED' && names.has(l.source) && names.has(l.target))
      .map((l) => ({
        id: l.id,
        source: l.source,
        target: l.target,
        label: l.label,
        className: `sg-edge${l.status === 'PROPOSED' ? ' proposed' : ''}`,
        style: { strokeWidth: Math.min(1 + (l.weight ?? 1) * 0.4, 4) },
      })),
  };
}

/** Relationship canvas for Narrative DNA, with a text list carrying the same content. */
export function StoryGraph({ entities, links, selected, onSelect }) {
  const flow = useMemo(() => layoutStory(entities, links, selected), [entities, links, selected]);
  if (!entities.length) return <p className="empty">No characters or places yet. Extract from the manuscript or add canon facts.</p>;
  return (
    <div className="kmap">
      <div className="kmap-canvas" role="group" aria-label={`Story graph with ${entities.length} entities and ${flow.edges.length} relationships. The list below has the same content.`}>
        <ReactFlow key={flow.nodes.length} nodes={flow.nodes} edges={flow.edges} fitView fitViewOptions={{ padding: 0.25, maxZoom: 1 }} nodesConnectable={false} elementsSelectable proOptions={{ hideAttribution: true }} onNodeClick={(_, n) => onSelect(n.id)}>
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <details className="kmap-list">
        <summary>Entities and relationships</summary>
        <ul>
          {entities.map((e) => (
            <li key={e.name}>
              <button type="button" className="btn sm ghost" aria-pressed={selected === e.name} onClick={() => onSelect(e.name)}>
                {e.name}
              </button>{' '}
              <span className="subtle">{e.kind.toLowerCase()}</span>
            </li>
          ))}
        </ul>
        <ul>
          {flow.edges.map((e) => (
            <li key={e.id}>
              {e.source} — {e.label} — {e.target}
              {e.className.includes('proposed') ? ' (proposed)' : ''}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
