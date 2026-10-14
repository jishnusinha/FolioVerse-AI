import { deflateRawSync } from 'node:zlib';

export interface FakeEntry {
  name: string;
  data?: Buffer;
  /** Uncompressed size written to the headers instead of the real one. */
  declared?: number;
  store?: boolean;
}

/** Minimal zip writer (no CRCs): enough for the upload scanner, which reads only the central directory. */
export function makeZip(entries: FakeEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = e.data ?? Buffer.alloc(0);
    const body = e.store ? raw : deflateRawSync(raw);
    const name = Buffer.from(e.name);
    const size = e.declared ?? raw.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(e.store ? 0 : 8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(e.store ? 0 : 8, 10);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(size, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    parts.push(local, name, body);
    central.push(dir, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Math.min(entries.length, 0xffff), 8);
  end.writeUInt16LE(Math.min(entries.length, 0xffff), 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

export const EPUB_MIMETYPE: FakeEntry = { name: 'mimetype', data: Buffer.from('application/epub+zip'), store: true };
