#!/usr/bin/env node
/**
 * pnpm demo — loads the interview demo into a running stack through the public API, so every row goes through the
 * same authorization, ingestion and ledger paths as real use. Everything is DEMO content written for this project:
 *
 *   Workspace  "Aster Research & Stories (DEMO)" owned by the demo account
 *   Knowledge  Project Atlas: Market Outlook 2026 (Markdown), the Atlas brief (PDF), Competitor notes (Markdown);
 *              a grounded answer with citations and a quick-summary artifact
 *   Writer     The Glass Meridian: two chapters, three scenes, canon facts, AI-proposed facts awaiting approval and a
 *              continuity issue (a scene contradicts canon on purpose)
 *   Library    Orbit of Small Lanterns (synthetic EPUB) on the shelf with reading progress and a highlight
 *   Discover   the synthetic DEMO catalog (loaded with FV_DEMO_CATALOG=true if missing), a taste profile and a set
 *
 * Idempotent: a rerun signs in and only adds what is missing. Model calls use whatever provider the stack is configured
 * with (the deterministic mock by default), so the demo costs nothing unless a live key is set on the server.
 *
 *   pnpm demo [-- --base http://localhost:3000] [--allow-remote]
 *   FV_DEMO_EMAIL / FV_DEMO_PASSWORD override the demo account.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Client, DEMO_DOC, uploadBytes, uploadText, waitReady } from './smoke.mjs';
import { ROOT } from './lib.mjs';

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const base = arg('--base', process.env.FV_API_URL ?? 'http://localhost:3000');
const EMAIL = process.env.FV_DEMO_EMAIL ?? 'demo@folioverse.example';
const DEFAULT_PASSWORD = 'folioverse-demo';
const PASSWORD = process.env.FV_DEMO_PASSWORD ?? DEFAULT_PASSWORD;
const WORKSPACE = 'Aster Research & Stories (DEMO)';

const step = (m) => console.log(`• ${m}`);
const bytes = (rel) => new Uint8Array(readFileSync(new URL(`../../${rel}`, import.meta.url)));

export const COMPETITOR_NOTES = `# Competitor notes (DEMO)

Three assisted-research tools dominate the shortlist. Lumen focuses on citation export and charges per seat.
Quarry indexes shared drives and prices by stored gigabyte. Ferrule bundles a writing assistant with research search.

Buyers in the 2026 survey ranked verifiable citations above answer speed. Two of three vendors cannot show which
document version an answer came from, which procurement teams flagged as an audit risk.
`;

const para = (blockId, text) => ({ type: 'paragraph', attrs: { blockId }, content: [{ type: 'text', text }] });

/** Original DEMO prose for The Glass Meridian. Scene 3 gives Ilse green eyes; canon says grey (continuity demo). */
export const GLASS_MERIDIAN = [
  {
    chapter: 'Chapter 1 — The Survey Line',
    scenes: [
      [
        'The Survey Line',
        [
          'The meridian ran through the observatory like a seam in old cloth, a brass strip set into the floor that every visitor stepped over without looking down.',
          'Ilse Varga had walked it every morning for eleven years. She knew where the brass had worn thin and where the night damp lifted it a hair from the stone.',
          'That morning the strip was cracked. A hairline fracture ran across it at the exact point where the noon shadow fell in midwinter.',
        ],
      ],
      [
        'The Archive Door',
        [
          'The archive door had not been opened since the last director left. Ilse found the key where he had promised it would be, taped beneath the third drawer of the chart table.',
          '"The meridian is cracking," she told the empty room, and heard how strange it sounded said aloud.',
          'Inside, the ledgers were dated in a hand she did not recognise, each entry ending with the same three words: line holds, unconfirmed.',
        ],
      ],
    ],
  },
  {
    chapter: 'Chapter 2 — Unconfirmed',
    scenes: [
      [
        'Night Readings',
        [
          'By the lamp, Ilse read the ledgers until the oil ran low, her green eyes aching from the copperplate and the columns of numbers that never quite added up.',
          'Every reading after the spring of the flood was a fraction of a second late, as if the sky itself had begun to hesitate.',
        ],
      ],
    ],
  },
];

async function signIn(c) {
  await c.get('/api/auth/csrf');
  const login = await c.post('/api/auth/login', { email: EMAIL, password: PASSWORD }, { allowError: true });
  if (login.status === 200 || login.status === 201) return false;
  if (login.status !== 401) throw new Error(`login -> ${login.status} ${login.data?.code ?? ''}`);
  const reg = await c.post('/api/auth/register', { email: EMAIL, password: PASSWORD, displayName: 'Mira Okafor' }, { allowError: true });
  if (reg.status === 409) throw new Error(`${EMAIL} exists with a different password; set FV_DEMO_PASSWORD to match it`);
  if (reg.status >= 400) throw new Error(`register -> ${reg.status} ${reg.data?.code ?? ''}`);
  return true;
}

async function finish(c, ws, runId) {
  const events = await c.sse(`${ws}/runs/${runId}/events`);
  const fin = events.find((e) => e.type === 'run.finished');
  if (!fin) throw new Error(`run ${runId} did not finish: ${JSON.stringify(events.at(-1)?.data ?? events.at(-1)?.type)}`);
  return { ...fin.data, citations: events.filter((e) => e.type === 'citation.validated').map((e) => e.data.state) };
}

async function knowledge(c, wid, ws, project) {
  if (project.name !== 'Project Atlas') {
    await c.patch(`${ws}/projects/${project.id}`, { name: 'Project Atlas', description: 'Market research on assisted-research tools (DEMO)' });
  }
  const have = new Set((await c.get(`${ws}/projects/${project.id}/sources`)).map((s) => s.title));
  const wanted = [
    ['Market Outlook 2026', () => uploadText(c, wid, project.id, 'Market Outlook 2026.md', DEMO_DOC)],
    ['Atlas brief', () => uploadBytes(c, wid, project.id, 'Atlas brief.pdf', bytes('datasets/synthetic/docs/atlas-brief.pdf'))],
    ['Competitor notes', () => uploadText(c, wid, project.id, 'Competitor notes.md', COMPETITOR_NOTES)],
  ];
  for (const [title, upload] of wanted) {
    if (have.has(title)) continue;
    const up = await upload();
    await waitReady(c, wid, up.sourceId);
    step(`Project Atlas: ingested "${title}"`);
  }
  const sources = await c.get(`${ws}/projects/${project.id}/sources`);
  const outlook = sources.find((s) => s.title === 'Market Outlook 2026');
  const runs = await c.get(`${ws}/runs?limit=50`);
  if (!runs.some((r) => r.graph === 'grounded_qa')) {
    const run = await c.post(`${ws}/runs`, {
      graph: 'grounded_qa',
      input: { question: 'Compare the growth projections and the main risks to them.' },
      scope: { sourceIds: sources.map((s) => s.id) },
    });
    const out = await finish(c, ws, run.runId ?? run.id);
    step(`grounded answer: ${out.outcome}, citations ${out.citations.join(', ') || 'none'}`);
  }
  if (!runs.some((r) => r.graph === 'insight')) {
    const run = await c.post(`${ws}/runs`, { graph: 'insight', input: { action: 'quick_summary' }, scope: { sourceIds: [outlook.id] } });
    const out = await finish(c, ws, run.runId);
    step(`summary artifact: ${out.artifactId ? 'saved' : 'missing'}`);
  }
  return sources.length;
}

async function writer(c, ws, project) {
  const list = await c.get(`${ws}/manuscripts?projectId=${project.id}`);
  if (list.some((m) => m.title === 'The Glass Meridian')) return step('The Glass Meridian: already present');
  const m = await c.post(`${ws}/manuscripts`, { title: 'The Glass Meridian', projectId: project.id });
  const ms = `${ws}/manuscripts/${m.id}`;
  const part = m.nodes.find((n) => n.kind === 'PART');
  let chapter = m.nodes.find((n) => n.kind === 'CHAPTER');
  let scene = m.nodes.find((n) => n.kind === 'SCENE');
  let words = 0;
  for (const [ci, ch] of GLASS_MERIDIAN.entries()) {
    if (ci === 0) await c.patch(`${ms}/nodes/${chapter.id}`, { title: ch.chapter });
    else chapter = await c.post(`${ms}/nodes`, { kind: 'CHAPTER', title: ch.chapter, parentId: part.id });
    for (const [si, [title, paras]] of ch.scenes.entries()) {
      if (ci === 0 && si === 0) await c.patch(`${ms}/nodes/${scene.id}`, { title, pov: 'Ilse' });
      else scene = await c.post(`${ms}/nodes`, { kind: 'SCENE', title, parentId: chapter.id });
      const doc = await c.get(`${ms}/nodes/${scene.id}/doc`);
      const saved = await c.patch(`${ms}/nodes/${scene.id}/doc`, {
        revision: doc.revision,
        content: { type: 'doc', content: paras.map((t, i) => para(`c${ci}s${si}p${i}`, t)) },
      });
      words += saved.wordCount ?? 0;
    }
  }
  await c.patch(ms, { dailyGoal: 1500 });
  for (const [subject, predicate, value] of [
    ['Ilse', 'eye color', 'grey'],
    ['Ilse', 'age', '41'],
    ['The meridian', 'material', 'brass'],
  ]) {
    await c.post(`${ms}/dna/facts`, { subject, predicate, value });
  }
  const ex = await c.post(`${ms}/dna/extract`, {});
  await finish(c, ws, ex.runId);
  const proposed = (await c.get(`${ms}/dna`)).facts.filter((f) => f.status === 'PROPOSED').length;
  const check = await c.post(`${ms}/continuity/check`, {});
  for (const r of check.runs) await finish(c, ws, r.runId);
  const issues = await c.get(`${ms}/continuity`);
  step(`The Glass Meridian: ${words} words, 3 canon facts, ${proposed} proposed, ${issues.length} continuity issue(s)`);
}

async function library(c, wid, ws, project) {
  const items = await c.get(`${ws}/library/items`);
  if (items.some((i) => i.book?.title === 'Orbit of Small Lanterns')) return step('Orbit of Small Lanterns: already shelved');
  const up = await uploadBytes(c, wid, project.id, 'small-lanterns.epub', bytes('datasets/synthetic/books/small-lanterns.epub'));
  const shelved = await c.post(`${ws}/library/items`, { sourceId: up.sourceId });
  await waitReady(c, wid, up.sourceId);
  const item = await c.get(`${ws}/library/items/${shelved.id}`);
  const ch = item.chapters[1] ?? item.chapters[0];
  const locator = { href: ch.href, type: 'application/xhtml+xml', title: ch.title, locations: { totalProgression: 0.46 } };
  await c.put(`${ws}/library/items/${item.id}/progress`, { locator, percent: 0.46, secondsDelta: 1260 });
  await c.post(`${ws}/library/items/${item.id}/annotations`, { id: crypto.randomUUID(), kind: 'HIGHLIGHT', locator, quote: 'Teodor Lusk had kept the archive for thirty years.' });
  step(`Orbit of Small Lanterns: ${item.chapters.length} chapters, 46% read, 1 highlight`);
}

async function discover(c, ws) {
  const d = `${ws}/discover`;
  let taste = await c.get(`${d}/taste`);
  if (taste.catalogSize < 500) {
    step('DEMO catalog missing: running the seed with FV_DEMO_CATALOG=true');
    const r = spawnSync('pnpm', ['--filter', '@folioverse/api', 'run', 'db:seed'], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, FV_DEMO_CATALOG: 'true' },
    });
    if (r.status !== 0) throw new Error('catalog seed failed');
    taste = await c.get(`${d}/taste`);
  }
  if (!taste.profile?.genres?.length) {
    const seeds = taste.seeds.filter((s) => s.genres.includes('Sci-fi')).slice(0, 2).map((s) => s.id);
    const genres = ['Sci-fi', 'Literary'].filter((g) => taste.vocabulary.genres.includes(g));
    await c.put(`${d}/taste`, { genres, moods: ['Atmospheric'], themes: ['memory'], seedItemIds: seeds });
    const set = await c.post(`${d}/recommendations`, { query: 'quiet science fiction about memory and isolation', k: 10 });
    step(`Discover: ${taste.catalogSize} DEMO titles, ${set.items.length} recommendations`);
  } else step(`Discover: ${taste.catalogSize} DEMO titles, taste already set`);
}

async function main() {
  const host = new URL(base).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host) && !process.argv.includes('--allow-remote')) {
    throw new Error(`refusing to load DEMO content into ${host}; pass --allow-remote if that is intended`);
  }
  const c = new Client(base);
  const ready = await c.get('/api/ready', { allowError: true });
  if (ready.status !== 200) throw new Error(`API at ${base} is not ready (${ready.status}); start it with pnpm dev or pnpm up`);

  const created = await signIn(c);
  step(`${created ? 'created' : 'signed in as'} ${EMAIL}`);
  const me = await c.get('/api/auth/me');
  const personal = me.workspaces.find((w) => w.kind === 'PERSONAL') ?? me.workspaces[0];
  const wid = personal.id;
  const ws = `/api/workspaces/${wid}`;
  if (personal.name !== WORKSPACE) await c.patch(ws, { name: WORKSPACE });

  const projects = await c.get(`${ws}/projects`);
  const byKind = (k) => projects.find((p) => p.kind === k);
  const docs = await knowledge(c, wid, ws, byKind('KNOWLEDGE'));
  step(`Project Atlas: ${docs} document(s) ready`);
  await writer(c, ws, byKind('WRITER'));
  await library(c, wid, ws, byKind('LIBRARY'));
  await discover(c, ws);

  console.log(`\nDEMO ready. Sign in at the web app as ${EMAIL}`);
  console.log(PASSWORD === DEFAULT_PASSWORD ? `Password: ${DEFAULT_PASSWORD} (the documented DEMO default; set FV_DEMO_PASSWORD to change it)` : 'Password: the value of FV_DEMO_PASSWORD');
}

main().catch((e) => {
  console.error(`DEMO FAILED: ${e.message}`);
  process.exit(1);
});
