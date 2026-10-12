import { useMemo } from 'react';
import dagre from '@dagrejs/dagre';
import { Background, Controls, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/base.css';
import { CiteChip } from '../runs/CitedText.jsx';

const W = 160;
const H = 40;

/**
 * Top-down layout of concept nodes; edge thickness follows co-occurrence weight.
 * @param {{ id: string, label: string, marker?: string | null }[]} nodes
 * @param {{ source: string, target: string, label?: string, weight?: number }[]} edges
 */
export function layoutMap(nodes, edges) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 24, ranksep: 48, marginx: 8, marginy: 8 });
  g.setDefaultEdgeLabel(() => ({}));
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) g.setNode(n.id, { width: W, height: H });
  const valid = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  for (const e of valid) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return {
    nodes: nodes.map((n) => {
      const p = g.node(n.id);
      return {
        id: n.id,
        position: { x: p.x - W / 2, y: p.y - H / 2 },
        data: { label: n.label, marker: n.marker ?? null },
        className: 'kmap-node',
        style: { width: W },
        draggable: false,
      };
    }),
    edges: valid.map((e, i) => ({
      id: `e${i}`,
      source: e.source,
      target: e.target,
      label: e.label && e.label !== 'co-occurs' ? e.label : undefined,
      className: 'kmap-edge',
      style: { strokeWidth: Math.min(1 + (e.weight ?? 1) * 0.6, 4) },
    })),
  };
}

/**
 * Knowledge map canvas. Selecting a concept opens the evidence for the passage it came from.
 * @param {{ nodes: any[], edges: any[], citations?: Record<string, any>, onCite?: (marker: string) => void }} props
 */
export default function KnowledgeMap({ nodes, edges, citations = {}, onCite }) {
  const flow = useMemo(() => layoutMap(nodes, edges), [nodes, edges]);
  const label = (id) => nodes.find((n) => n.id === id)?.label ?? id;
  if (!nodes.length) return <p className="empty">No concepts were found in the selected sources.</p>;
  return (
    <div className="kmap">
      <div className="kmap-canvas" role="group" aria-label={`Knowledge map with ${nodes.length} concepts and ${edges.length} relations. The list below has the same content.`}>
        <ReactFlow
          nodes={flow.nodes}
          edges={flow.edges}
          fitView
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, n) => n.data.marker && onCite?.(n.data.marker)}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <details className="kmap-list">
        <summary>Concepts and relations</summary>
        <ul>
          {nodes.map((n) => (
            <li key={n.id}>
              {n.label}{' '}
              {n.marker && <CiteChip marker={n.marker} citation={citations[n.marker]} onClick={onCite ? () => onCite(n.marker) : undefined} />}
            </li>
          ))}
        </ul>
        <ul>
          {edges.map((e, i) => (
            <li key={i}>
              {label(e.source)} — {e.label ?? 'related'} — {label(e.target)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
