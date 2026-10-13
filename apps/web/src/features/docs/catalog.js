/**
 * Documentation catalog shared by the in-app docs (/app/docs) and the Starlight site build (apps/docs).
 * Pure functions over repository files: page frontmatter, docs/planning/IMPLEMENTATION_STATUS.md and links.
 * No Vite- or DOM-specific code, so `apps/docs/scripts/sync-content.mjs` can import it from Node.
 */

/** Section order in navigation; pages declare one of these in their frontmatter. */
export const DOC_SECTIONS = ['Users', 'Developers', 'AI/ML', 'DevOps', 'Reference'];

/** Sidebar directory of each section on the documentation site (apps/docs/astro.config.mjs). */
export const SITE_DIRS = { Users: 'start', Developers: 'start', 'AI/ML': 'ai-ml', DevOps: 'devops', Reference: 'reference' };

/** URL of a guide page on the documentation site, which is served under /docs. */
export const siteHref = (page) => `/docs/${SITE_DIRS[page.section]}/${page.slug}/`;

/**
 * @typedef {object} DocPage
 * @property {string} slug
 * @property {string} path repository path of the markdown source
 * @property {string} title
 * @property {string} description
 * @property {string} section
 * @property {number} order
 * @property {number[]} gates
 * @property {string[]} blocked names of entries in the status file's External setup list
 * @property {string} demo why the feature shows DEMO data, when it does
 * @property {string} body markdown without frontmatter
 */

function parseValue(raw) {
  const v = raw.trim();
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    return inner ? inner.split(',').map((x) => parseValue(x)) : [];
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

/**
 * Splits `---` frontmatter (flat `key: value` lines, inline `[a, b]` lists) from the markdown body.
 * @param {string} text
 * @returns {{ data: Record<string, any>, body: string }}
 */
export function parseFrontmatter(text) {
  const src = text.replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) return { data: {}, body: src };
  /** @type {Record<string, any>} */
  const data = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i < 0) throw new Error(`Invalid frontmatter line: ${line}`);
    data[line.slice(0, i).trim()] = parseValue(line.slice(i + 1));
  }
  return { data, body: src.slice(m[0].length) };
}

/**
 * @param {string} path repository path, e.g. `docs/guide/rag-pipeline.md`
 * @param {string} text file contents
 * @returns {DocPage}
 */
export function toPage(path, text) {
  const { data, body } = parseFrontmatter(text);
  for (const key of ['title', 'section']) if (!data[key]) throw new Error(`${path}: frontmatter needs "${key}"`);
  if (!DOC_SECTIONS.includes(data.section)) throw new Error(`${path}: unknown section "${data.section}"`);
  const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
  return {
    slug: data.slug ?? path.split('/').pop().replace(/\.md$/, ''),
    path,
    title: String(data.title),
    description: String(data.description ?? ''),
    section: data.section,
    order: Number(data.order ?? 100),
    gates: list(data.gates).map(Number),
    blocked: list(data.blocked).map(String),
    demo: String(data.demo ?? ''),
    body,
  };
}

/** @param {DocPage[]} pages */
export function sortPages(pages) {
  return [...pages].sort(
    (a, b) => DOC_SECTIONS.indexOf(a.section) - DOC_SECTIONS.indexOf(b.section) || a.order - b.order || a.title.localeCompare(b.title),
  );
}

const GATE_HEADING = /^## Gates? (\d+)(?:[–-](\d+))? — (?:(.+?) — )?(DONE|PLANNED|IN_PROGRESS|BLOCKED)( locally)?(?: \((.*)\))?\s*$/;
const STATES = ['DONE', 'PLANNED', 'IN_PROGRESS', 'BLOCKED'];

/**
 * Reads gate states and the External setup list from IMPLEMENTATION_STATUS.md.
 * @param {string} text
 */
export function parseStatus(text) {
  /** @type {Map<number, { gate: number, title: string, state: string, locally: boolean, note: string }>} */
  const gates = new Map();
  /** @type {{ name: string, state: string, text: string }[]} */
  const external = [];
  let inExternal = false;
  let inEntry = false;
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('## ')) {
      inExternal = /^## External setup/.test(line);
      const g = GATE_HEADING.exec(line);
      if (g) {
        const from = Number(g[1]);
        const to = g[2] ? Number(g[2]) : from;
        for (let n = from; n <= to; n++) gates.set(n, { gate: n, title: g[3] ?? '', state: g[4], locally: Boolean(g[5]), note: g[6] ?? '' });
      }
      continue;
    }
    if (inExternal && line.startsWith('- ')) {
      const i = line.indexOf(' — ');
      const rest = i < 0 ? '' : line.slice(i + 3);
      const state = STATES.find((s) => rest.startsWith(s));
      if (state) external.push({ name: line.slice(2, i).trim(), state, text: rest });
      inEntry = Boolean(state);
    } else if (inExternal && inEntry && /^\s+\S/.test(line)) {
      external[external.length - 1].text += ` ${line.trim()}`;
    } else {
      inEntry = false;
    }
  }
  return { gates, external };
}

/**
 * @typedef {object} Badge
 * @property {'implemented' | 'planned' | 'demo' | 'blocked'} kind
 * @property {string} label
 * @property {string} detail
 */

/**
 * Status badges for a page. "Implemented" only when every gate the page describes is DONE in the status file;
 * DEMO when the page says what is simulated; one BLOCKED badge per External setup entry that is still BLOCKED.
 * @param {DocPage} page
 * @param {ReturnType<typeof parseStatus>} status
 * @returns {Badge[]}
 */
export function badgesFor(page, status) {
  /** @type {Badge[]} */
  const out = [];
  if (page.gates.length) {
    const entries = page.gates.map((n) => {
      const g = status.gates.get(n);
      if (!g) throw new Error(`${page.path}: gate ${n} is not in the status file`);
      return g;
    });
    const open = entries.filter((g) => g.state !== 'DONE');
    const describe = (g) => `Gate ${g.gate}${g.title ? ` ${g.title}` : ''}: ${g.state}${g.locally ? ' locally' : ''}`;
    if (open.length) out.push({ kind: 'planned', label: 'Planned', detail: open.map(describe).join('; ') });
    else out.push({ kind: 'implemented', label: 'Implemented', detail: entries.map(describe).join('; ') });
  }
  if (page.demo) out.push({ kind: 'demo', label: 'DEMO', detail: page.demo });
  for (const name of page.blocked) {
    const e = status.external.find((x) => x.name === name);
    if (!e) throw new Error(`${page.path}: "${name}" is not in the status file's External setup list`);
    if (e.state === 'BLOCKED') out.push({ kind: 'blocked', label: `Blocked: ${name}`, detail: e.text });
  }
  return out;
}

/** GitHub-style heading slug, used for in-page anchors on both surfaces. */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

/** `## Heading` lines (outside code fences) for the "On this page" outline. */
export function outline(body) {
  const out = [];
  let fence = false;
  for (const line of body.split('\n')) {
    if (line.startsWith('```')) fence = !fence;
    const m = !fence && /^## (.+)$/.exec(line);
    if (m) out.push({ text: m[1].replace(/`/g, ''), id: slugify(m[1]) });
  }
  return out;
}

/** Repository path of `href` written relative to the file `fromFile`. */
export function joinPath(fromFile, href) {
  const parts = fromFile.split('/').slice(0, -1);
  for (const seg of href.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** Repository files that the documentation site republishes, mapped to their URL under /docs. */
export function siteMirror(path) {
  if (path === 'docs/planning/DECISION_LOG.md') return '/docs/project/decision-log/';
  if (path === 'docs/planning/IMPLEMENTATION_STATUS.md') return '/docs/project/status/';
  const runbook = /^infrastructure\/runbooks\/([\w-]+)\.md$/.exec(path);
  if (runbook) return runbook[1] === 'README' ? '/docs/runbooks/' : `/docs/runbooks/${runbook[1]}/`;
  return null;
}

/**
 * Resolves a markdown link written relative to the source file.
 * @param {string} fromFile repository path of the page
 * @param {string} href absolute URLs and same-origin paths (`/docs/...`, `/app/...`) are returned unchanged
 * @param {{ pageHref: (page: DocPage) => string, pages: DocPage[], repoUrl?: string }} ctx
 * @returns {{ kind: 'page' | 'site' | 'external' | 'anchor' | 'repo' | 'path', href: string }}
 *   `site` is a page republished on the documentation site (see `siteMirror`); `path` is a bare repository path.
 */
export function resolveLink(fromFile, href, ctx) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/')) return { kind: 'external', href };
  if (href.startsWith('#')) return { kind: 'anchor', href };
  const [file, hash = ''] = href.split('#');
  const target = joinPath(fromFile, file);
  const page = ctx.pages.find((p) => p.path === target);
  const anchor = hash ? `#${hash}` : '';
  if (page) return { kind: 'page', href: ctx.pageHref(page) + anchor };
  const mirror = siteMirror(target);
  if (mirror) return { kind: 'site', href: mirror + anchor };
  if (ctx.repoUrl) return { kind: 'repo', href: `${ctx.repoUrl.replace(/\/$/, '')}/${target}${anchor}` };
  return { kind: 'path', href: target };
}
