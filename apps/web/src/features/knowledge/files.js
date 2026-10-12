/** Upload types accepted by the API (`file-scan.ts` ALLOWED). */
export const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'txt', 'md', 'epub'];
export const ACCEPT_ATTR = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',');

const BY_MIME = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'text/markdown': 'MD',
  'text/plain': 'TXT',
  'application/epub+zip': 'EPUB',
};

export function extensionOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name ?? '');
  return m ? m[1].toLowerCase() : '';
}

/** Short type label used by the `.ft` file-type chip. */
export function fileType(source) {
  return BY_MIME[source?.mimeType] ?? (extensionOf(source?.title).toUpperCase() || 'FILE');
}

export function isAllowedFile(name) {
  return ALLOWED_EXTENSIONS.includes(extensionOf(name));
}

export function formatBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

const RTF = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' }) : null;

/** "3 minutes ago" style label; falls back to a date for anything older than a week. */
export function relativeTime(iso, now = Date.now()) {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  const s = Math.round((t - now) / 1000);
  const abs = Math.abs(s);
  if (!RTF || abs > 7 * 86400) return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (abs < 45) return 'Just now';
  if (abs < 3600) return RTF.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return RTF.format(Math.round(s / 3600), 'hour');
  return RTF.format(Math.round(s / 86400), 'day');
}

/**
 * Builds a nested tree from flat folders (adjacency list).
 * @param {{ id: string, parentId: string|null, name: string, path: string }[]} folders
 */
export function folderTree(folders) {
  const byParent = new Map();
  for (const f of folders) {
    const k = f.parentId ?? null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(f);
  }
  const build = (parentId) =>
    (byParent.get(parentId) ?? []).sort((a, b) => a.name.localeCompare(b.name)).map((f) => ({ ...f, children: build(f.id) }));
  return build(null);
}

/** Ids of a folder and all of its descendants, using the materialized path. */
export function folderScope(folders, folderId) {
  const f = folders.find((x) => x.id === folderId);
  if (!f) return new Set();
  return new Set(folders.filter((x) => x.id === f.id || x.path.startsWith(`${f.path}/`)).map((x) => x.id));
}
