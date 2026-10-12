/** Allowed source types. Detection relies on magic bytes, never on the client-declared MIME type. */
export const ALLOWED = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  epub: 'application/epub+zip',
  txt: 'text/plain',
  md: 'text/markdown',
} as const;

export type FileKind = keyof typeof ALLOWED;

export function kindFromFilename(name: string): FileKind | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'markdown') return 'md';
  return (Object.keys(ALLOWED) as FileKind[]).includes(ext as FileKind) ? (ext as FileKind) : null;
}

export function sanitizeFilename(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? 'file';
  const cleaned = base
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"|?*]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180);
  return cleaned || 'file';
}

export interface ScanResult {
  ok: boolean;
  kind?: FileKind;
  reason?: string;
}

const MAX_ZIP_ENTRIES_HINT = 20000;

/** Validates the stored bytes against the declared kind. Returns a quarantine reason on mismatch. */
export function scanBytes(buf: Buffer, declared: FileKind): ScanResult {
  if (buf.length === 0) return { ok: false, reason: 'EMPTY_FILE' };
  const head = buf.subarray(0, 8);
  const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  switch (declared) {
    case 'pdf':
      if (!buf.subarray(0, 1024).toString('latin1').includes('%PDF-')) return { ok: false, reason: 'MAGIC_MISMATCH' };
      return { ok: true, kind: 'pdf' };
    case 'epub': {
      if (!isZip) return { ok: false, reason: 'MAGIC_MISMATCH' };
      if (!buf.subarray(30, 80).toString('latin1').includes('application/epub+zip')) return { ok: false, reason: 'EPUB_MIMETYPE_MISSING' };
      if (countZipEntries(buf) > MAX_ZIP_ENTRIES_HINT) return { ok: false, reason: 'ZIP_TOO_MANY_ENTRIES' };
      return { ok: true, kind: 'epub' };
    }
    case 'docx': {
      if (!isZip) return { ok: false, reason: 'MAGIC_MISMATCH' };
      if (!buf.includes(Buffer.from('word/document.xml'))) return { ok: false, reason: 'DOCX_STRUCTURE_MISSING' };
      if (countZipEntries(buf) > MAX_ZIP_ENTRIES_HINT) return { ok: false, reason: 'ZIP_TOO_MANY_ENTRIES' };
      return { ok: true, kind: 'docx' };
    }
    case 'txt':
    case 'md': {
      if (buf.includes(0)) return { ok: false, reason: 'BINARY_CONTENT' };
      const text = buf.toString('utf8');
      if (text.includes('\uFFFD')) return { ok: false, reason: 'INVALID_UTF8' };
      return { ok: true, kind: declared };
    }
  }
}

function countZipEntries(buf: Buffer): number {
  // End of central directory record: total entries at offset 10 (2 bytes).
  const sig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const idx = buf.lastIndexOf(sig);
  if (idx < 0 || idx + 12 > buf.length) return 0;
  return buf.readUInt16LE(idx + 10);
}
