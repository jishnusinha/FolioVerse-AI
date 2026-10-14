import { readFileSync } from 'node:fs';
import { ALL_ROUTES } from '../src/app/routes.js';
import { FAKE_CSRF } from '../src/test/fakeApi.js';

export const PDF = new Uint8Array(readFileSync(new URL('../../../datasets/synthetic/docs/atlas-brief.pdf', import.meta.url)));
export const EPUB = new Uint8Array(readFileSync(new URL('../../../datasets/synthetic/books/small-lanterns.epub', import.meta.url)));

/** Fake API options that give every route real DEMO content (documents, an artifact, a book, admin pages). */
export const FULL_DEMO = { pdfBytes: PDF, epubBytes: EPUB, artifacts: ['study_notes'], superAdmin: true };

/** A concrete URL for every registered route, built from the fake API's seeded DEMO data. */
export function urlFor(id, fake) {
  const wid = fake.db.workspaces[0].id;
  const outlook = fake.db.sources.find((s) => s.title === 'Market Outlook 2026.pdf');
  const ms = fake.writer.writer.manuscripts.find((m) => m.title === 'The Glass Meridian');
  const runs = fake.ai.ai.runs.filter((r) => r.workspaceId === wid);
  switch (id) {
    case 'project':
      return `/app/knowledge/projects/${outlook.projectId}`;
    case 'document':
      return `/app/knowledge/projects/${outlook.projectId}/documents/${outlook.id}`;
    case 'artifact': {
      const a = fake.db.knowledge.artifacts[0];
      return `/app/knowledge/projects/${a.projectId}/artifacts/${a.id}`;
    }
    case 'search':
      return '/app/search?q=pricing';
    case 'manuscript':
      return `/app/writer/manuscripts/${ms.id}`;
    case 'dna':
    case 'continuity':
    case 'manuscript-print':
      return `/app/writer/manuscripts/${ms.id}/${id === 'manuscript-print' ? 'print' : id}`;
    case 'reader':
      return `/app/library/books/${fake.library.library.items[0].id}/read`;
    case 'studio-run':
      return `/app/studio/runs/${runs[0].id}`;
    case 'studio-compare':
      return `/app/studio/compare?runs=${runs.slice(0, 2).map((r) => r.id).join(',')}`;
    case 'studio-battle': {
      const res = fake.handle('POST', `/api/workspaces/${wid}/studio/battles`, { runId: runs[0].id, models: ['mock-grounded', 'mock-concise'] }, { 'x-csrf-token': FAKE_CSRF });
      if (res.status !== 201) throw new Error(`battle seed failed: ${res.status}`);
      return `/app/studio/battles/${res.body.id}`;
    }
    case 'docs-page':
      return '/app/docs/user-guide';
    case 'settings-section':
      return '/app/settings/budgets';
    case 'reset':
    case 'verify':
    case 'accept-invite':
      return `${ALL_ROUTES.find((r) => r.id === id).path}?token=demo-token`;
    default: {
      const r = ALL_ROUTES.find((x) => x.id === id);
      if (r.path.includes(':')) throw new Error(`No sample URL for route ${id}`);
      return r.path;
    }
  }
}
