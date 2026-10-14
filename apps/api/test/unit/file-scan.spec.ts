import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Document, Packer, Paragraph } from 'docx';
import { checkZip, kindFromFilename, sanitizeFilename, scanBytes, ZIP_LIMITS, zipEntries } from '../../src/modules/sources/file-scan';
import { csvCell } from '../../src/modules/costs/costs.controller';
import { EPUB_MIMETYPE, makeZip } from '../zip';

const mimetype = EPUB_MIMETYPE;

describe('file scanning', () => {
  it('detects kinds from filenames', () => {
    expect(kindFromFilename('Report.PDF')).toBe('pdf');
    expect(kindFromFilename('notes.markdown')).toBe('md');
    expect(kindFromFilename('virus.exe')).toBeNull();
  });

  it('strips path traversal and control characters', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('..\\..\\win.ini')).toBe('win.ini');
    expect(sanitizeFilename('a\u0000b<c>.pdf')).toBe('abc.pdf');
    expect(sanitizeFilename('...')).toBe('file');
  });

  it('accepts a real PDF header and rejects a spoofed one', () => {
    expect(scanBytes(Buffer.from('%PDF-1.7\n...'), 'pdf').ok).toBe(true);
    expect(scanBytes(Buffer.from('MZ\x90\x00 not a pdf'), 'pdf')).toEqual({ ok: false, reason: 'MAGIC_MISMATCH' });
  });

  it('rejects binary content declared as text', () => {
    expect(scanBytes(Buffer.from([0x68, 0x00, 0x69]), 'txt').reason).toBe('BINARY_CONTENT');
    expect(scanBytes(Buffer.from('hello world'), 'md').ok).toBe(true);
  });

  it('rejects zips that are not EPUB/DOCX', () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)]);
    expect(scanBytes(zip, 'epub').reason).toBe('EPUB_MIMETYPE_MISSING');
    expect(scanBytes(zip, 'docx').reason).toBe('DOCX_STRUCTURE_MISSING');
  });

  it('rejects empty files', () => {
    expect(scanBytes(Buffer.alloc(0), 'pdf').reason).toBe('EMPTY_FILE');
  });
});

describe('archive guard (zip bombs)', () => {
  it('accepts the real sample EPUB and a generated DOCX', async () => {
    const epub = readFileSync(resolve(__dirname, '../../../../datasets/synthetic/books/small-lanterns.epub'));
    expect(scanBytes(epub, 'epub')).toEqual({ ok: true, kind: 'epub' });
    const docx = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('Hello')] }] }));
    expect(scanBytes(Buffer.from(docx), 'docx')).toEqual({ ok: true, kind: 'docx' });
    expect(zipEntries(Buffer.from(docx))!.map((e) => e.name)).toContain('word/document.xml');
  });

  it('quarantines an entry that inflates far beyond its compressed size', () => {
    const bomb = makeZip([mimetype, { name: 'OEBPS/ch1.xhtml', data: Buffer.alloc(ZIP_LIMITS.ratioMinBytes + 1024) }]);
    expect(bomb.length).toBeLessThan(64 * 1024);
    expect(scanBytes(bomb, 'epub')).toEqual({ ok: false, reason: 'ZIP_RATIO' });
  });

  it('quarantines archives whose declared total exceeds the limit', () => {
    const per = 9 * 1024 * 1024;
    const entries = Array.from({ length: Math.ceil(ZIP_LIMITS.uncompressedBytes / per) + 1 }, (_, i) => ({
      name: `word/part${i}.xml`,
      data: Buffer.from('<w/>'.repeat(200)),
      declared: per,
    }));
    const zip = makeZip([{ name: 'word/document.xml', data: Buffer.from('<w:document/>') }, ...entries]);
    expect(scanBytes(zip, 'docx')).toEqual({ ok: false, reason: 'ZIP_TOO_LARGE' });
  });

  it('counts entries from the central directory, not the 16-bit end record', () => {
    const many = Array.from({ length: ZIP_LIMITS.entries + 1 }, (_, i) => ({ name: `e${i}`, store: true }));
    const zip = makeZip([mimetype, ...many]);
    zip.writeUInt16LE(3, zip.length - 22 + 10);
    expect(checkZip(zip)).toBe('ZIP_TOO_MANY_ENTRIES');
  });

  it('quarantines traversal paths and unreadable directories', () => {
    expect(checkZip(makeZip([mimetype, { name: '../../etc/cron.d/x', data: Buffer.from('x') }]))).toBe('ZIP_PATH_TRAVERSAL');
    expect(checkZip(makeZip([mimetype, { name: '/abs.xhtml', data: Buffer.from('x') }]))).toBe('ZIP_PATH_TRAVERSAL');
    const truncated = makeZip([mimetype, { name: 'a.xhtml', data: Buffer.from('x') }]);
    truncated.writeUInt32LE(truncated.length, truncated.length - 22 + 16);
    expect(scanBytes(truncated, 'epub')).toEqual({ ok: false, reason: 'ZIP_MALFORMED' });
  });
});

describe('csv export escaping', () => {
  it('neutralizes spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@SUM')).toBe("'@SUM");
    expect(csvCell('\t=1')).toBe("'\t=1");
    expect(csvCell('\r=1')).toBe(`"'\r=1"`);
    expect(csvCell('a\rb')).toBe('"a\rb"');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(null)).toBe('');
  });
});
