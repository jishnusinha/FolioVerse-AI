// Raw documentation sources bundled into one chunk that /app/docs imports on demand.
// The same files feed the documentation site (apps/docs/scripts/sync-content.mjs).

const ROOT_PREFIX = /^(\.\.\/)+/;
const repoPath = (key) => key.replace(ROOT_PREFIX, '');
const byRepoPath = (modules) => Object.fromEntries(Object.entries(modules).map(([k, v]) => [repoPath(k), v]));

/** Markdown of every guide page, keyed by repository path. */
export const PAGE_SOURCES = byRepoPath(
  import.meta.glob(['../../../../../docs/guide/*.md', '../../../../../docs/notebooks.md'], { eager: true, query: '?raw', import: 'default' }),
);

/** URLs of committed screenshots (`pnpm docs:shots`), keyed by repository path; empty until they are captured. */
export const IMAGES = byRepoPath(
  import.meta.glob('../../../../../docs/screenshots/*.png', { eager: true, query: '?url', import: 'default' }),
);

export { default as STATUS_TEXT } from '../../../../../docs/planning/IMPLEMENTATION_STATUS.md?raw';
