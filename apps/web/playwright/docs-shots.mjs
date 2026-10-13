#!/usr/bin/env node
/**
 * Documentation screenshots of the real app (`pnpm docs:shots`), written to docs/screenshots/ with a manifest.
 * Needs a running stack: `pnpm dev` (default http://localhost:5173) or `pnpm up` (FV_SHOTS_BASE_URL=http://localhost:8080).
 * Registers a throwaway user, uploads the DEMO market-outlook document, asks a question through the UI and
 * captures the pages the guides show. Answers come from whatever the model registry resolves; without a
 * provider key that is the DEMO mock model, and the screenshots say so. Nothing is drawn or edited afterwards.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { Client, DEMO_DOC, registerUser, uploadText, waitReady } from '../../../infrastructure/scripts/smoke.mjs';

const BASE = (process.env.FV_SHOTS_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
const OUT = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const VIEWPORT = { width: 1440, height: 900 };
const QUESTION = 'What annual growth does the base case project through 2030?';

function commit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

async function seed() {
  const client = new Client(BASE);
  const ready = await client.get('/api/ready', { allowError: true });
  if (ready.status !== 200) throw new Error(`stack not ready at ${BASE}: /api/ready -> ${ready.status}`);
  const { workspaceId } = await registerUser(client, 'docs');
  const projects = await client.get(`/api/workspaces/${workspaceId}/projects`);
  const knowledge = projects.find((p) => p.kind === 'KNOWLEDGE');
  const done = await uploadText(client, workspaceId, knowledge.id, 'market-outlook-demo.md', DEMO_DOC);
  await waitReady(client, workspaceId, done.sourceId);
  return { client, projectId: knowledge.id, sourceId: done.sourceId };
}

async function main() {
  const { client, projectId, sourceId } = await seed();
  console.log(`docs:shots: seeded a DEMO document for a throwaway user at ${BASE}`);
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'light', reducedMotion: 'reduce' });
  await context.addCookies([...client.cookies].map(([name, value]) => ({ name, value, url: BASE })));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const shots = [];
  async function shot(file, description) {
    // Pages keep event streams open, so "network idle" never happens; wait for loading placeholders instead.
    await page.waitForFunction(() => !document.querySelector('.skeleton, [aria-busy="true"]'), null, { timeout: 30_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}${file}`, animations: 'disabled' });
    shots.push({ file, route: new URL(page.url()).pathname.replace(/[0-9a-f-]{36}/g, ':id'), description });
    console.log(`docs:shots: ${file}`);
  }

  try {
    await page.goto(`${BASE}/app`);
    await page.getByRole('heading', { level: 1 }).first().waitFor();
    await shot('home.png', 'Home with recent work and quick actions');

    await page.goto(`${BASE}/app/knowledge/projects/${projectId}/documents/${sourceId}`);
    await page.getByLabel('Ask a grounded question').fill(QUESTION);
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    const chat = page.getByRole('region', { name: 'Grounded conversation' });
    await chat.getByText('Answered').waitFor({ timeout: 120_000 });
    await chat.getByRole('button', { name: /Run receipt/ }).waitFor({ timeout: 30_000 });
    await shot('document-answer.png', 'Document workspace with a cited answer (DEMO mock model unless a provider key is set)');

    await chat.getByRole('button', { name: /Run receipt/ }).click();
    await chat.getByRole('link', { name: /Open in Developer Studio/ }).click();
    await page.getByRole('group', { name: 'LangGraph workflow grounded_qa' }).waitFor({ timeout: 30_000 });
    await page.getByRole('region', { name: 'Execution events' }).getByText('run.finished').waitFor({ timeout: 30_000 });
    await shot('studio-run.png', 'AI Developer Studio: the recorded grounded_qa run, its graph and events');

    await page.getByRole('link', { name: 'Cost Center' }).click();
    await page.getByRole('table', { name: /Recent AI runs/ }).waitFor({ timeout: 30_000 });
    await shot('cost-center.png', 'Cost Center with the ledger entries of the run above');
  } finally {
    await browser.close();
  }
  if (errors.length) throw new Error(`page errors while capturing: ${errors.join('; ')}`);

  const manifest = {
    generatedAt: new Date().toISOString(),
    commit: commit(),
    baseUrl: new URL(BASE).origin,
    viewport: VIEWPORT,
    colorScheme: 'light',
    note: 'Captured from the running app by apps/web/playwright/docs-shots.mjs; not edited. Model output is the DEMO mock model unless a provider key was configured.',
    shots,
  };
  writeFileSync(`${OUT}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`docs:shots: ${shots.length} screenshots and manifest.json in docs/screenshots`);
}

main().catch((e) => {
  console.error(`docs:shots FAILED: ${e.message}`);
  process.exit(1);
});
