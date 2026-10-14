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

export const ZIP_LIMITS = {
  entries: 20_000,
  uncompressedBytes: 512 * 1024 * 1024,
  /** Ratio checked only for entries above `ratioMinBytes`; small XML parts compress well legitimately. */
  ratio: 100,
  ratioMinBytes: 10 * 1024 * 1024,
};

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
      const zip = checkZip(buf);
      return zip ? { ok: false, reason: zip } : { ok: true, kind: 'epub' };
    }
    case 'docx': {
      if (!isZip) return { ok: false, reason: 'MAGIC_MISMATCH' };
      if (!buf.includes(Buffer.from('word/document.xml'))) return { ok: false, reason: 'DOCX_STRUCTURE_MISSING' };
      const zip = checkZip(buf);
      return zip ? { ok: false, reason: zip } : { ok: true, kind: 'docx' };
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

export interface ZipEntry {
  name: string;
  compressed: number;
  uncompressed: number;
}

/**
 * Walks the central directory instead of trusting the end record's 16-bit entry count. Returns null when
 * the directory cannot be read. ZIP64 sizes (0xFFFFFFFF) are reported as-is and fail the size limit.
 */
export function zipEntries(buf: Buffer): ZipEntry[] | null {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > buf.length) return null;
  const size = buf.readUInt32LE(eocd + 12);
  let at = buf.readUInt32LE(eocd + 16);
  const end = at + size;
  if (end > eocd) return null;
  const out: ZipEntry[] = [];
  while (at < end) {
    if (at + 46 > end || buf.readUInt32LE(at) !== 0x02014b50) return null;
    const nameLen = buf.readUInt16LE(at + 28);
    const next = at + 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
    if (next > end) return null;
    out.push({
      name: buf.subarray(at + 46, at + 46 + nameLen).toString('utf8'),
      compressed: buf.readUInt32LE(at + 20),
      uncompressed: buf.readUInt32LE(at + 24),
    });
    if (out.length > ZIP_LIMITS.entries) break;
    at = next;
  }
  return out;
}

/** Zip-bomb guard: returns a quarantine reason, or null when the archive is within limits. */
export function checkZip(buf: Buffer): string | null {
  const entries = zipEntries(buf);
  if (!entries) return 'ZIP_MALFORMED';
  if (entries.length > ZIP_LIMITS.entries) return 'ZIP_TOO_MANY_ENTRIES';
  let total = 0;
  for (const e of entries) {
    if (e.name.split(/[\\/]/).includes('..') || e.name.startsWith('/')) return 'ZIP_PATH_TRAVERSAL';
    total += e.uncompressed;
    if (e.uncompressed > ZIP_LIMITS.ratioMinBytes && e.uncompressed > ZIP_LIMITS.ratio * Math.max(e.compressed, 1)) return 'ZIP_RATIO';
  }
  return total > ZIP_LIMITS.uncompressedBytes ? 'ZIP_TOO_LARGE' : null;
}
