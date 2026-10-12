import dagre from '@dagrejs/dagre';

export const NODE_W = 150;
export const NODE_H = 46;

/**
 * Left-to-right layout for a graph description from `GET /graphs/:name`.
 * @param {{ nodes: { id: string, label: string, kind: string }[], edges: { source: string, target: string, conditional: boolean }[] }} spec
 */
export function layoutGraph(spec) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 56, marginx: 12, marginy: 12 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of spec.nodes) g.setNode(n.id, { width: n.kind === 'terminal' ? 70 : NODE_W, height: NODE_H });
  for (const e of spec.edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  const nodes = spec.nodes.map((n) => {
    const p = g.node(n.id);
    return { ...n, x: p.x - p.width / 2, y: p.y - p.height / 2, w: p.width, h: p.height };
  });
  const edges = spec.edges.map((e) => {
    const pts = g.edge(e.source, e.target)?.points ?? [];
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    return { ...e, d };
  });
  const { width = 0, height = 0 } = g.graph();
  return { nodes, edges, width, height };
}

/**
 * Display state of a graph node from recorded node executions and the run status.
 * @param {string} id
 * @param {Record<string, { status: string }>} executions keyed by node name
 * @param {string} runStatus
 */
export function nodeState(id, executions, runStatus) {
  if (id === '__start__') return runStatus === 'QUEUED' ? 'idle' : 'succeeded';
  const ex = executions[id];
  if (id === '__end__') return ['SUCCEEDED', 'PARTIAL'].includes(runStatus) ? 'succeeded' : 'idle';
  if (!ex) return ['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(runStatus) ? 'skipped' : 'idle';
  if (ex.status === 'RUNNING') return id === 'generate' && runStatus === 'STREAMING' ? 'streaming' : 'running';
  if (ex.status === 'FAILED') return 'failed';
  return 'succeeded';
}
