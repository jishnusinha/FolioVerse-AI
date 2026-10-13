// Generates src/content/docs (git-ignored) from the repository, so each fact has one source:
//   docs/guide/*.md, docs/notebooks.md      guide pages with status badges from IMPLEMENTATION_STATUS.md
//   infrastructure/runbooks/*.md            runbooks
//   docs/planning/{IMPLEMENTATION_STATUS,DECISION_LOG}.md   mirrored as-is
//   packages/contracts/openapi/{api,ai}.json                API references
//   apps/api/prisma/schema.prisma                           data model (ERD)
// The in-app help (/app/docs) renders the same guide pages through the same catalog module.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOC_SECTIONS,
  SITE_DIRS,
  badgesFor,
  joinPath,
  parseStatus,
  resolveLink,
  siteHref,
  sortPages,
  toPage,
} from '../../web/src/features/docs/catalog.js';
import { erdSvg, modelTable, parsePrisma } from './lib/erd.mjs';
import { escapeHtml, escapePlaceholders, frontmatter, mapLinks, stripTitle } from './lib/markdown.mjs';
import { referenceMarkdown } from './lib/openapi.mjs';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(APP, '../..');
const OUT = join(APP, 'src/content/docs');
const PUBLIC_OUT = join(APP, 'public/media');
const BASE = '/docs';
const REPO_URL = String(process.env.FV_DOCS_REPO_URL || process.env.VITE_REPO_URL || '').replace(/\/+$/, '');

const read = (path) => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n');

function write(rel, text) {
  const file = join(OUT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const pageHref = siteHref;

function loadPages() {
  const paths = [
    ...readdirSync(join(ROOT, 'docs/guide'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => `docs/guide/${f}`),
    'docs/notebooks.md',
  ];
  return sortPages(paths.map((p) => toPage(p, read(p))));
}

/** Rewrites links for the site; images under docs/ are copied to public/media, missing ones are reported. */
function rewrite(fromFile, body, pages, missing) {
  const ctx = { pages, pageHref, repoUrl: REPO_URL };
  const linked = mapLinks(body, (l) => {
    if (l.image) {
      if (/^[a-z]+:/i.test(l.href)) return l.raw;
      const target = joinPath(fromFile, l.href);
      if (!target.startsWith('docs/')) throw new Error(`${fromFile}: image outside docs/: ${l.href}`);
      const rel = target.slice('docs/'.length);
      if (!existsSync(join(ROOT, target))) {
        missing.push(target);
        return `*Screenshot not captured yet (\`${target}\`). \`pnpm docs:shots\` records it from the running app.*`;
      }
      mkdirSync(dirname(join(PUBLIC_OUT, rel)), { recursive: true });
      copyFileSync(join(ROOT, target), join(PUBLIC_OUT, rel));
      return `![${l.text}](${BASE}/media/${rel})`;
    }
    const r = resolveLink(fromFile, l.href, ctx);
    if (r.kind === 'path') {
      const plain = l.text.replace(/`/g, '');
      return plain.includes(r.href.replace(/#.*$/, '')) ? l.text : `${l.text} (\`${r.href}\`)`;
    }
    return `[${l.text}](${r.href}${l.title ? ` "${l.title}"` : ''})`;
  });
  return escapePlaceholders(linked);
}

function statusBlock(page, status) {
  const badges = badgesFor(page, status);
  if (!badges.length) return '';
  const spans = badges
    .map((b) => `<span class="fv-badge" data-kind="${b.kind}" title="${escapeHtml(b.detail)}">${escapeHtml(b.label)}</span>`)
    .join('');
  const out = [
    `<p class="fv-badges">${spans}<a class="fv-badge-note" href="${BASE}/project/status/">from the implementation status</a></p>`,
    '',
  ];
  if (page.demo) out.push(':::note[DEMO data]', page.demo, ':::', '');
  const blocked = badges.filter((b) => b.kind === 'blocked');
  if (blocked.length) {
    out.push(':::caution[Needs external setup]');
    for (const b of blocked) out.push(`- **${b.label.replace(/^Blocked: /, '')}**: ${b.detail}`);
    out.push(':::', '');
  }
  return out.join('\n');
}

function syncGuide(pages, status, missing) {
  for (const page of pages) {
    const sectionIndex = DOC_SECTIONS.indexOf(page.section);
    const fm = frontmatter({
      title: page.title,
      description: page.description || undefined,
      sidebar: { order: sectionIndex * 100 + page.order },
    });
    const body = rewrite(page.path, page.body, pages, missing);
    write(`${SITE_DIRS[page.section]}/${page.slug}.md`, fm + statusBlock(page, status) + body);
  }
}

function mirror(src, dest, { title, order, intro }, pages, missing) {
  const { body } = stripTitle(read(src));
  const source = REPO_URL ? `[\`${src}\`](${REPO_URL}/${src})` : `\`${src}\``;
  const note = `${intro ? `${intro} ` : ''}Mirrored from ${source}; edit that file, not this page.`;
  write(dest, frontmatter({ title, sidebar: { order } }) + `${note}\n\n` + rewrite(src, body, pages, missing));
}

function syncRunbooks(pages, missing) {
  const dir = 'infrastructure/runbooks';
  const files = readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.md'));
  let order = 1;
  for (const f of files.sort()) {
    const src = `${dir}/${f}`;
    const isIndex = f === 'README.md';
    const title = isIndex ? 'Runbooks' : stripTitle(read(src)).title || f.replace(/\.md$/, '');
    mirror(src, isIndex ? 'runbooks/index.md' : `runbooks/${f}`, { title, order: isIndex ? 0 : order++ }, pages, missing);
  }
}

function syncApiReference() {
  const api = JSON.parse(read('packages/contracts/openapi/api.json'));
  const ai = JSON.parse(read('packages/contracts/openapi/ai.json'));
  const opts = (order) => ({ sidebar: { order }, tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 2 } });
  write(
    'reference/api.md',
    frontmatter({ title: 'API reference', description: 'Every route of the NestJS API, generated from its OpenAPI document.', ...opts(450) }) +
      referenceMarkdown(api, {
        groupOf: (_path, op) => op.tags?.[0] ?? 'other',
        intro: [
          'Generated from `packages/contracts/openapi/api.json`, which `pnpm --filter @folioverse/api run swagger:export`',
          'writes from the controllers and `pnpm contracts:check` keeps current. Routes are same-origin under `/api`.',
          'Mutating requests need the `x-csrf-token` header matching the `fv_csrf` cookie. Workspace routes answer 404',
          'to non-members. Response bodies are not described in the document yet; the web client types in',
          '`packages/contracts/generated` and the integration tests in `apps/api/test` show their shape.',
        ].join(' '),
      }),
  );
  write(
    'reference/ai-service.md',
    frontmatter({ title: 'AI service API', description: 'Internal FastAPI routes, generated from its OpenAPI document.', ...opts(451) }) +
      referenceMarkdown(ai, {
        groupOf: (path) => {
          const seg = path.split('/').filter(Boolean);
          return seg[0] === 'internal' ? seg[1] : 'health';
        },
        intro: [
          'Generated from `packages/contracts/openapi/ai.json` (`python -m folioverse_ai.openapi_export`; a pytest',
          'fails when it is stale). The service is internal: only the API and worker call it, with a short-lived',
          'ES256 service token, and retrieval filters come only from the signed scope token, never from the request body.',
        ].join(' '),
      }),
  );
}

function syncDataModel() {
  const { models, enums } = parsePrisma(read('apps/api/prisma/schema.prisma'));
  const schemas = [...new Set(models.map((m) => m.schema))];
  const anchor = (name) => name.toLowerCase();
  const out = [
    `Generated from \`apps/api/prisma/schema.prisma\`: ${models.length} models and ${enums.length} enums in the`,
    `Postgres schemas ${schemas.map((s) => `\`${s}\``).join(', ')}. The \`langgraph\` schema belongs to the Python`,
    'checkpointer and is not managed by Prisma.',
    '',
    'Arrows point from the model holding a foreign key to the model it references. Only relations declared with',
    '`@relation` are drawn; several tables (for example `cost_entries`) keep a `workspace_id` without a Prisma',
    'relation and appear unconnected below the graph. Each box lists keys first and up to eight columns; select a',
    'model to see all of its fields.',
    '',
  ];
  for (const schema of schemas) {
    const list = models.filter((m) => m.schema === schema);
    out.push(`## Schema \`${schema}\``, '');
    const svg = erdSvg(list, { id: `erd-${schema}`, title: `Entity-relationship diagram of the ${schema} schema`, href: (m) => `#${anchor(m.name)}` });
    out.push(`<div class="fv-erd">\n${svg}\n</div>`, '');
    for (const m of list) {
      out.push(`### ${m.name}`, '', `Table \`${schema}.${m.table}\`.${m.doc ? ` ${m.doc}` : ''}`, '', modelTable(m, { anchor }), '');
    }
  }
  out.push('## Enums', '', '| Enum | Schema | Values |', '| --- | --- | --- |');
  for (const e of enums) out.push(`| \`${e.name}\` | ${e.schema} | ${e.values.map((v) => `\`${v}\``).join(', ')} |`);
  write(
    'reference/data-model.md',
    frontmatter({
      title: 'Data model',
      description: 'Prisma models and relations per Postgres schema, with entity-relationship diagrams.',
      sidebar: { order: 452 },
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 2 },
    }) + out.join('\n') + '\n',
  );
}

function syncIndex(pages, status) {
  const out = [
    'FolioVerse is a knowledge, writing, reading and discovery platform where every AI answer cites its sources',
    'and every model call is costed. These pages are generated from the repository on each build, so they match',
    'the code they describe. Inside the app the same guides are under **Help** (`/app/docs`).',
    '',
  ];
  for (const section of DOC_SECTIONS) {
    const list = pages.filter((p) => p.section === section);
    if (!list.length) continue;
    out.push(`## ${section}`, '');
    for (const p of list) out.push(`- [${p.title}](${pageHref(p)})${p.description ? `: ${p.description}` : ''}`);
    out.push('');
  }
  out.push(
    '## Reference and operations',
    '',
    `- [API reference](${BASE}/reference/api/) and [AI service API](${BASE}/reference/ai-service/)`,
    `- [Data model](${BASE}/reference/data-model/)`,
    `- [Runbooks](${BASE}/runbooks/)`,
    `- [Implementation status](${BASE}/project/status/) and [decision log](${BASE}/project/decision-log/)`,
    '',
    '## Build status',
    '',
    'Badges on each page come from the implementation status file. A page is **Implemented** only when every',
    'gate it describes is DONE; **DEMO** marks simulated data; **Blocked** names an external account or key that',
    'has not been configured.',
    '',
    '| Gate | Scope | State |',
    '| --- | --- | --- |',
  );
  for (const g of [...status.gates.values()].sort((a, b) => a.gate - b.gate)) {
    out.push(`| ${g.gate} | ${g.title} | ${g.state}${g.locally ? ' locally' : ''}${g.note ? ` (${g.note})` : ''} |`);
  }
  out.push('');
  write('index.md', frontmatter({ title: 'FolioVerse documentation', description: 'Guides, reference and runbooks for FolioVerse AI.' }) + out.join('\n'));
}

export function sync() {
  rmSync(OUT, { recursive: true, force: true });
  rmSync(PUBLIC_OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const status = parseStatus(read('docs/planning/IMPLEMENTATION_STATUS.md'));
  const pages = loadPages();
  const missing = [];
  syncGuide(pages, status, missing);
  syncRunbooks(pages, missing);
  mirror('docs/planning/IMPLEMENTATION_STATUS.md', 'project/status.md', { title: 'Implementation status', order: 1 }, pages, missing);
  mirror('docs/planning/DECISION_LOG.md', 'project/decision-log.md', { title: 'Decision log', order: 2 }, pages, missing);
  syncApiReference();
  syncDataModel();
  syncIndex(pages, status);
  return { pages: pages.length, missing };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { pages, missing } = sync();
  console.log(`docs: synced ${pages} guide pages, runbooks, status, decision log, API references and data model`);
  for (const m of missing) console.warn(`docs: missing screenshot ${m} (run pnpm docs:shots against a running stack)`);
}
