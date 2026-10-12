import { kindFromFilename, sanitizeFilename, scanBytes } from '../../src/modules/sources/file-scan';
import { csvCell } from '../../src/modules/costs/costs.controller';

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

describe('csv export escaping', () => {
  it('neutralizes spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@SUM')).toBe("'@SUM");
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(null)).toBe('');
  });
});
