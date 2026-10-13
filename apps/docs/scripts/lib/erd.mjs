// Entity-relationship diagrams from apps/api/prisma/schema.prisma: a small parser plus a dagre layout
// rendered as inline SVG, one diagram per Postgres schema (app, ai, rec), and field tables per model.
import dagre from '@dagrejs/dagre';
import { cell } from './openapi.mjs';

const SCALARS = new Set(['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes', 'Unsupported']);

/**
 * @typedef {{ name: string, type: string, list: boolean, optional: boolean, attrs: string, id: boolean, unique: boolean,
 *   relation: null | { fields: string[], references: string[] }, kind?: 'scalar' | 'enum' | 'relation' }} Field
 * @typedef {{ name: string, table: string, schema: string, fields: Field[], compositeId: string[], doc: string }} Model
 * @typedef {{ name: string, schema: string, values: string[] }} Enum
 */

function listArg(attrs, key) {
  const m = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`).exec(attrs);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * Parses models and enums (blocks only; comments, generators and datasources are skipped).
 * @param {string} text
 * @returns {{ models: Model[], enums: Enum[] }}
 */
export function parsePrisma(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  /** @type {Model[]} */
  const models = [];
  /** @type {Enum[]} */
  const enums = [];
  let doc = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('///')) {
      doc.push(line.slice(3).trim());
      continue;
    }
    const head = /^(model|enum)\s+(\w+)\s*\{$/.exec(line);
    if (!head) {
      if (line) doc = [];
      continue;
    }
    const body = [];
    for (i++; i < lines.length && lines[i].trim() !== '}'; i++) body.push(lines[i].trim());
    const schema = body.map((l) => /^@@schema\("(\w+)"\)/.exec(l)?.[1]).find(Boolean) ?? 'public';
    if (head[1] === 'enum') {
      enums.push({ name: head[2], schema, values: body.filter((l) => /^\w+$/.test(l)) });
    } else {
      const fields = [];
      let compositeId = [];
      let table = head[2];
      for (const l of body) {
        if (l.startsWith('@@id')) compositeId = /\[([^\]]*)\]/.exec(l)[1].split(',').map((s) => s.trim());
        if (l.startsWith('@@map')) table = /"([^"]+)"/.exec(l)[1];
        const f = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(l);
        if (!f || l.startsWith('//') || l.startsWith('@@')) continue;
        const attrs = f[5].replace(/\s*\/\/.*$/, '');
        const rel = /@relation\(/.test(attrs) && listArg(attrs, 'fields').length ? { fields: listArg(attrs, 'fields'), references: listArg(attrs, 'references') } : null;
        fields.push({ name: f[1], type: f[2], list: Boolean(f[3]), optional: Boolean(f[4]), attrs, id: /@id\b/.test(attrs), unique: /@unique\b/.test(attrs), relation: rel });
      }
      models.push({ name: head[2], table, schema, fields, compositeId, doc: doc.join(' ') });
    }
    doc = [];
  }
  const modelNames = new Set(models.map((m) => m.name));
  for (const m of models) for (const f of m.fields) f.kind = modelNames.has(f.type) ? 'relation' : SCALARS.has(f.type) ? 'scalar' : 'enum';
  return { models, enums };
}

/** Declared relations: the model holding the foreign key points at the referenced model. */
export function relations(models) {
  const out = [];
  for (const m of models) {
    for (const f of m.fields) if (f.relation) out.push({ from: m.name, to: f.type, field: f.name, fields: f.relation.fields, optional: f.optional });
  }
  return out;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CHAR_W = 7.3;
const ROW_H = 18;
const HEAD_H = 26;
const PAD = 10;
const GAP = 28;
const MAX_WIDTH = 1100;

/** Key columns only (primary and declared foreign keys); the field tables list everything. */
function nodeRows(model) {
  const fks = new Set(model.fields.flatMap((f) => f.relation?.fields ?? []));
  const pk = new Set([...model.fields.filter((f) => f.id).map((f) => f.name), ...model.compositeId]);
  const scalars = model.fields.filter((f) => f.kind !== 'relation');
  const keys = scalars.filter((f) => pk.has(f.name) || fks.has(f.name));
  const shown = keys.map((f) => ({ text: `${f.name}: ${f.type}${f.optional ? '?' : ''}`, mark: pk.has(f.name) ? 'PK' : 'FK' }));
  return { shown, more: scalars.length - keys.length };
}

function nodeSize(model, rows) {
  const longest = Math.max(model.name.length + 2, ...rows.shown.map((r) => r.text.length + 4), rows.more ? 16 : 0);
  const n = rows.shown.length + (rows.more ? 1 : 0);
  return { width: Math.ceil(longest * CHAR_W + PAD * 2), height: HEAD_H + n * ROW_H + 8 };
}

function renderNode(model, rows, x, y, w, h, href) {
  const parts = [`<g class="erd-node"><a href="${esc(href(model))}">`];
  parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>`);
  parts.push(`<rect class="erd-head" x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${HEAD_H - 2}" rx="5"/>`);
  parts.push(`<text class="erd-title" x="${x + PAD}" y="${y + 17}">${esc(model.name)}</text></a>`);
  rows.shown.forEach((r, i) => {
    const ty = y + HEAD_H + 14 + i * ROW_H;
    parts.push(`<text x="${x + PAD}" y="${ty}">${r.mark ? `<tspan class="erd-key">${r.mark} </tspan>` : '<tspan>   </tspan>'}${esc(r.text)}</text>`);
  });
  if (rows.more) {
    const label = `+${rows.more} column${rows.more === 1 ? '' : 's'}`;
    parts.push(`<text class="erd-more" x="${x + PAD}" y="${y + HEAD_H + 14 + rows.shown.length * ROW_H}">${label}</text>`);
  }
  parts.push('</g>');
  return parts.join('');
}

/** Connected components of the relation graph, largest first; unrelated models are singletons. */
function components(names, edges) {
  const parent = new Map(names.map((n) => [n, n]));
  const find = (n) => (parent.get(n) === n ? n : find(parent.get(n)));
  for (const e of edges) parent.set(find(e.from), find(e.to));
  const groups = new Map();
  for (const n of names) {
    const root = find(n);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(n);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

/** Lays out one component top to bottom (referencing models above the models they point at). */
function layoutComponent(names, edges, info) {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: 'TB', nodesep: 20, ranksep: 44, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  const set = new Set(names);
  for (const n of names) g.setNode(n, { width: info.get(n).width, height: info.get(n).height });
  for (const e of edges) if (set.has(e.from)) g.setEdge(e.from, e.to, {}, `${e.from}.${e.field}`);
  dagre.layout(g);
  return {
    width: Math.ceil(g.graph().width),
    height: Math.ceil(g.graph().height),
    nodes: names.map((n) => ({ name: n, x: g.node(n).x - g.node(n).width / 2, y: g.node(n).y - g.node(n).height / 2 })),
    edges: g.edges().map((e) => ({ name: e.name, points: g.edge(e).points })),
  };
}

/**
 * Lays out one schema's models: each connected component with dagre, then components and unrelated models
 * packed into rows no wider than MAX_WIDTH (or the widest component).
 * Returns an SVG string without blank lines so it stays a single raw-HTML block in markdown.
 * @param {Model[]} models models of one schema
 * @param {{ id: string, title: string, href: (m: Model) => string }} opts
 */
export function erdSvg(models, { id, title, href }) {
  const names = new Set(models.map((m) => m.name));
  const edges = relations(models).filter((r) => names.has(r.to) && r.from !== r.to);
  const info = new Map(
    models.map((m) => {
      const rows = nodeRows(m);
      return [m.name, { model: m, rows, ...nodeSize(m, rows) }];
    }),
  );
  const blocks = components([...names], edges).map((c) => layoutComponent(c, edges, info));
  const maxW = Math.max(MAX_WIDTH, ...blocks.map((b) => b.width + 2 * PAD));
  const placedNodes = [];
  const placedEdges = [];
  let x = PAD;
  let y = PAD;
  let rowH = 0;
  for (const b of blocks) {
    if (x + b.width > maxW && x > PAD) {
      x = PAD;
      y += rowH + GAP;
      rowH = 0;
    }
    for (const n of b.nodes) placedNodes.push({ ...info.get(n.name), x: Math.round(x + n.x), y: Math.round(y + n.y) });
    for (const e of b.edges) placedEdges.push({ name: e.name, points: e.points.map((p) => [Math.round(x + p.x), Math.round(y + p.y)]) });
    x += b.width + GAP;
    rowH = Math.max(rowH, b.height);
  }
  const width = Math.max(...placedNodes.map((p) => p.x + p.width)) + PAD;
  const height = y + rowH + PAD;

  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="${id}-title" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<title id="${id}-title">${esc(title)}</title>`,
    `<defs><marker id="${id}-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="erd-arrow" d="M0,0 L10,5 L0,10 z"/></marker></defs>`,
  ];
  for (const e of placedEdges) {
    out.push(`<path class="erd-edge" marker-end="url(#${id}-arrow)" d="M${e.points.map((p) => p.join(',')).join(' L')}"><title>${esc(e.name)}</title></path>`);
  }
  for (const p of placedNodes) out.push(renderNode(p.model, p.rows, p.x, p.y, p.width, p.height, href));
  out.push('</svg>');
  return out.join('\n');
}

/** Field table for one model; relation types link to the target model's section. */
export function modelTable(model, { anchor }) {
  const fks = new Set(model.fields.flatMap((f) => f.relation?.fields ?? []));
  const pk = new Set([...model.fields.filter((f) => f.id).map((f) => f.name), ...model.compositeId]);
  const lines = ['| Field | Type | Key | Attributes |', '| --- | --- | --- | --- |'];
  for (const f of model.fields) {
    const type = `${f.type}${f.list ? '[]' : ''}${f.optional ? '?' : ''}`;
    const shown = f.kind === 'relation' ? `[${type}](#${anchor(f.type)})` : `\`${type}\``;
    const key = [pk.has(f.name) && 'PK', fks.has(f.name) && 'FK', f.unique && 'unique'].filter(Boolean).join(', ');
    lines.push(`| \`${f.name}\` | ${shown} | ${key} | ${cell(f.attrs ? `\`${f.attrs}\`` : '')} |`);
  }
  return lines.join('\n');
}
