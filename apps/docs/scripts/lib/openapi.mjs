// Renders an OpenAPI 3.x document as Starlight markdown: operations grouped by tag (or path), then schemas.
// The documents are packages/contracts/openapi/api.json (NestJS) and ai.json (FastAPI); both are committed
// and checked for freshness, so the reference always matches the code that produced them.

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

/** Escapes text for a markdown table cell. */
export function cell(text) {
  return String(text ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function refName(ref) {
  return ref.split('/').pop();
}

/** Anchor Starlight (github-slugger) gives a `### Name` heading. */
export function schemaAnchor(name) {
  return name.toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

/** Human-readable type; schema references link to their section on the same page. */
export function typeOf(s) {
  if (!s) return 'any';
  if (s.$ref) {
    const n = refName(s.$ref);
    return `[${n}](#${schemaAnchor(n)})`;
  }
  for (const key of ['anyOf', 'oneOf']) {
    if (s[key]) return s[key].map(typeOf).join(' or ');
  }
  if (s.allOf) return s.allOf.map(typeOf).join(' and ');
  if (s.enum) return s.enum.map((v) => `\`${v}\``).join(' / ');
  if (s.type === 'array') return `${typeOf(s.items)}[]`;
  if (Array.isArray(s.type)) return s.type.join(' or ');
  const t = s.type ?? (s.properties ? 'object' : 'any');
  return s.format ? `${t} (${s.format})` : t;
}

const CONSTRAINTS = [
  ['minLength', 'min length'],
  ['maxLength', 'max length'],
  ['minimum', 'min'],
  ['maximum', 'max'],
  ['minItems', 'min items'],
  ['maxItems', 'max items'],
  ['pattern', 'pattern'],
];

function notes(s) {
  const out = [];
  if (s.description) out.push(s.description);
  for (const [key, label] of CONSTRAINTS) if (s[key] !== undefined) out.push(`${label} \`${s[key]}\``);
  if (s.default !== undefined) out.push(`default \`${JSON.stringify(s.default)}\``);
  return out.join('; ');
}

/** Operations in document order, with their group and the method in upper case. */
export function operations(doc, groupOf) {
  const out = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op = item[method];
      if (op) out.push({ path, method: method.toUpperCase(), op, group: groupOf(path, op) });
    }
  }
  return out;
}

function groupBy(ops) {
  /** @type {Map<string, typeof ops>} */
  const groups = new Map();
  for (const o of ops) {
    if (!groups.has(o.group)) groups.set(o.group, []);
    groups.get(o.group).push(o);
  }
  return groups;
}

function renderOperation({ path, method, op }) {
  const lines = [`### \`${method} ${path}\``, ''];
  const about = [op.summary, op.description].filter(Boolean).join(' — ');
  lines.push(`${about ? `${cell(about)} · ` : ''}Operation \`${op.operationId}\``, '');
  const params = op.parameters ?? [];
  if (params.length) {
    lines.push('| Parameter | In | Type | Required | Notes |', '| --- | --- | --- | --- | --- |');
    for (const p of params) {
      const s = p.schema ?? {};
      lines.push(
        `| \`${p.name}\` | ${p.in} | ${cell(typeOf(s))} | ${p.required ? 'yes' : 'no'} | ${cell([p.description, notes({ ...s, description: undefined })].filter(Boolean).join('; '))} |`,
      );
    }
    lines.push('');
  }
  const body = op.requestBody?.content;
  if (body) {
    const [type, media] = Object.entries(body)[0];
    lines.push(`Request body (\`${type}\`${op.requestBody.required ? ', required' : ''}): ${typeOf(media.schema)}`, '');
  }
  const responses = Object.entries(op.responses ?? {}).map(([code, r]) => {
    const media = r.content && Object.values(r.content)[0];
    const schema = media?.schema ? ` ${typeOf(media.schema)}` : '';
    return `\`${code}\`${schema}${r.description ? ` ${r.description}` : ''}`;
  });
  if (responses.length) lines.push(`Responses: ${responses.join(', ')}`, '');
  return lines.join('\n');
}

function renderSchema(name, s) {
  const lines = [`### ${name}`, ''];
  if (s.description) lines.push(cell(s.description), '');
  const props = Object.entries(s.properties ?? {});
  if (!props.length) {
    lines.push(`Type: ${typeOf(s)}`, '');
    return lines.join('\n');
  }
  const required = new Set(s.required ?? []);
  lines.push('| Field | Type | Required | Notes |', '| --- | --- | --- | --- |');
  for (const [field, ps] of props) {
    lines.push(`| \`${field}\` | ${cell(typeOf(ps))} | ${required.has(field) ? 'yes' : 'no'} | ${cell(notes(ps))} |`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * @param {any} doc OpenAPI document
 * @param {{ groupOf: (path: string, op: any) => string, intro?: string }} opts
 * @returns {string} markdown body (no frontmatter)
 */
export function referenceMarkdown(doc, { groupOf, intro = '' }) {
  const ops = operations(doc, groupOf);
  const groups = groupBy(ops);
  const out = [];
  if (intro) out.push(intro.trim(), '');
  if (doc.info?.description) out.push(doc.info.description, '');
  const schemes = Object.entries(doc.components?.securitySchemes ?? {});
  if (schemes.length) {
    const desc = schemes.map(([k, s]) => `\`${k}\` (${s.type}${s.in ? ` in ${s.in}` : ''}${s.name ? ` \`${s.name}\`` : ''})`);
    out.push(`Security schemes: ${desc.join(', ')}.`, '');
  }
  out.push(
    `${ops.length} operations in ${groups.size} groups; OpenAPI ${doc.openapi}, document version \`${doc.info?.version ?? 'n/a'}\`.`,
    '',
    '| Group | Operations |',
    '| --- | --- |',
    ...[...groups].map(([g, list]) => `| [${g}](#${schemaAnchor(g)}) | ${list.length} |`),
    '',
  );
  for (const [g, list] of groups) {
    out.push(`## ${g}`, '');
    for (const o of list) out.push(renderOperation(o));
  }
  const schemas = Object.entries(doc.components?.schemas ?? {});
  if (schemas.length) {
    out.push('## Schemas', '');
    for (const [name, s] of schemas) out.push(renderSchema(name, s));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
