import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { badgesFor, joinPath, outline, parseFrontmatter, parseStatus, resolveLink, siteHref, siteMirror, slugify, toPage } from './catalog.js';
import { loadDocs } from './content.js';

/** Repository root; Vitest runs with apps/web as the working directory. */
const ROOT = resolve(process.cwd(), '../..');

const STATUS = `# Status

## Gate 0 — Foundation — DONE (CI push BLOCKED: no remote)
## Gate 3 — Vertical slice — DONE locally
## Gates 12–13 — PLANNED

## External setup (Section N)
- OpenAI API key — BLOCKED until provided. Mock provider used.
- GCP project / WIF — BLOCKED. Terraform is ready;
  follow the deploy runbook.
- Kaggle account — DONE
`;

const page = (fm, body = 'Body') => toPage('docs/guide/x.md', `---\n${fm}\n---\n${body}`);

describe('frontmatter and pages', () => {
  it('parses flat values, numbers, quoted strings and inline lists', () => {
    const { data, body } = parseFrontmatter('---\ntitle: "A: b"\norder: 2\ngates: [1, 3]\nblocked: []\n# note\n---\nText');
    expect(data).toEqual({ title: 'A: b', order: 2, gates: [1, 3], blocked: [] });
    expect(body).toBe('Text');
  });

  it('validates the title and section and fills defaults', () => {
    expect(() => page('section: Users')).toThrow(/needs "title"/);
    expect(() => page('title: T\nsection: Elsewhere')).toThrow(/unknown section/);
    expect(page('title: T\nsection: Users')).toMatchObject({ slug: 'x', order: 100, gates: [], blocked: [], demo: '' });
  });
});

describe('status file', () => {
  it('reads gate ranges, local qualifiers and multi-line external entries', () => {
    const s = parseStatus(STATUS);
    expect(s.gates.get(0)).toMatchObject({ state: 'DONE', note: 'CI push BLOCKED: no remote' });
    expect(s.gates.get(3)).toMatchObject({ state: 'DONE', locally: true });
    expect(s.gates.get(12)).toEqual({ gate: 12, title: '', state: 'PLANNED', locally: false, note: '' });
    expect(s.gates.get(13)?.state).toBe('PLANNED');
    expect(s.external.map((e) => [e.name, e.state])).toEqual([
      ['OpenAI API key', 'BLOCKED'],
      ['GCP project / WIF', 'BLOCKED'],
      ['Kaggle account', 'DONE'],
    ]);
    expect(s.external[1].text).toBe('BLOCKED. Terraform is ready; follow the deploy runbook.');
  });

  it('derives badges: implemented only when every gate is DONE, demo, and blocked per open external entry', () => {
    const s = parseStatus(STATUS);
    const kinds = (fm) => badgesFor(page(fm), s).map((b) => b.label);
    expect(kinds('title: T\nsection: Users\ngates: [0, 3]')).toEqual(['Implemented']);
    expect(kinds('title: T\nsection: Users\ngates: [3, 12]\ndemo: Mock data')).toEqual(['Planned', 'DEMO']);
    expect(kinds('title: T\nsection: Users\nblocked: [OpenAI API key, Kaggle account]')).toEqual(['Blocked: OpenAI API key']);
    expect(badgesFor(page('title: T\nsection: Users\ngates: [3, 12]'), s)[0].detail).toBe('Gate 12: PLANNED');
    expect(() => kinds('title: T\nsection: Users\ngates: [7]')).toThrow(/gate 7/);
    expect(() => kinds('title: T\nsection: Users\nblocked: [Stripe]')).toThrow(/Stripe/);
  });
});

describe('links and outline', () => {
  const pages = [page('title: RAG\nsection: AI/ML\nslug: rag-pipeline')].map((p) => ({ ...p, path: 'docs/guide/rag-pipeline.md' }));
  const ctx = { pages, pageHref: (p) => `/app/docs/${p.slug}` };

  it('resolves guide pages, mirrored files, repository paths and external links', () => {
    expect(resolveLink('docs/guide/a.md', 'rag-pipeline.md#chunking', ctx)).toEqual({ kind: 'page', href: '/app/docs/rag-pipeline#chunking' });
    expect(resolveLink('docs/guide/a.md', '../planning/DECISION_LOG.md', ctx)).toEqual({ kind: 'site', href: '/docs/project/decision-log/' });
    expect(resolveLink('docs/guide/a.md', '../../infrastructure/runbooks/deploy.md', ctx).href).toBe('/docs/runbooks/deploy/');
    expect(resolveLink('docs/guide/a.md', '../../infrastructure/runbooks/README.md', ctx).href).toBe('/docs/runbooks/');
    expect(resolveLink('docs/a.md', '../ml-notebooks/README.md#kaggle', ctx)).toEqual({ kind: 'path', href: 'ml-notebooks/README.md' });
    expect(resolveLink('docs/a.md', '../ml-notebooks/x.py', { ...ctx, repoUrl: 'https://h/r/blob/main/' }).href).toBe('https://h/r/blob/main/ml-notebooks/x.py');
    expect(resolveLink('docs/a.md', 'https://example.com', ctx).kind).toBe('external');
    expect(resolveLink('docs/a.md', '/docs/reference/data-model/', ctx).kind).toBe('external');
    expect(resolveLink('docs/a.md', '#top', ctx).kind).toBe('anchor');
    expect(siteMirror('docs/guide/x.md')).toBeNull();
  });

  it('builds GitHub-style anchors for h2 headings outside code', () => {
    expect(slugify('Cost & `ledger` entries')).toBe('cost--ledger-entries');
    expect(outline('## One\n```\n## not\n```\n### Sub\n## Two `x`')).toEqual([
      { text: 'One', id: 'one' },
      { text: 'Two x', id: 'two-x' },
    ]);
  });
});

describe('repository documentation', () => {
  it('every guide page is valid against the real status file and every link target exists', async () => {
    const { pages } = await loadDocs();
    expect(pages.length).toBeGreaterThanOrEqual(15);
    expect(new Set(pages.map((p) => p.slug)).size).toBe(pages.length);
    for (const p of pages) {
      if (p.gates.length) expect(p.badges.filter((b) => b.kind === 'implemented' || b.kind === 'planned'), p.path).toHaveLength(1);
      expect(siteHref(p)).toMatch(/^\/docs\/(start|ai-ml|devops|reference)\/[\w-]+\/$/);
      for (const [, href] of p.body.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const r = resolveLink(p.path, href, { pages, pageHref: (x) => `/app/docs/${x.slug}` });
        if (r.kind === 'path' || r.kind === 'site') {
          const target = joinPath(p.path, href.replace(/#.*$/, ''));
          expect(existsSync(resolve(ROOT, target)), `${p.path} -> ${target}`).toBe(true);
        }
      }
    }
  });
});
