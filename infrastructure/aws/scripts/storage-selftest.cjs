/* eslint-disable */
// Runs inside the API image (stdin of `node -`): exercises the compiled StorageService against the configured bucket
// with the same credentials the API uses, under the _selftest/ prefix, and removes everything it wrote.
//   FV_SELFTEST_MODE=full     upload (streamed), head, download, Range read, multipart assembly, signed GET, delete
//   FV_SELFTEST_MODE=prepare  upload one object; print {"key","sha256","url"} as one JSON line (consumed by a pipe)
//   FV_SELFTEST_MODE=cleanup  delete FV_SELFTEST_KEY
const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const { Readable } = require('node:stream');
const { StorageService } = require('/app/dist/src/infra/storage.service.js');

const sha = (b) => createHash('sha256').update(b).digest('hex');
const ok = (m) => console.error(`ok   ${m}`);
const drain = async (stream) => {
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
};

async function main() {
  const s = new StorageService();
  const mode = process.env.FV_SELFTEST_MODE || 'full';
  if (mode === 'cleanup') {
    const key = process.env.FV_SELFTEST_KEY || '';
    assert.ok(key.startsWith('_selftest/'), 'FV_SELFTEST_KEY must be under _selftest/');
    await s.delete(key);
    assert.equal(await s.head(key), null);
    return ok(`deleted ${key}`);
  }

  await s.ensureBucket();
  ok(`bucket ${s.bucket} reachable`);
  const prefix = `_selftest/${new Date().toISOString().replace(/[:.]/g, '')}-${randomBytes(4).toString('hex')}`;
  const body = Buffer.concat([Buffer.from('%PDF-1.4\n'), randomBytes(300 * 1024)]);

  if (mode === 'prepare') {
    const key = `${prefix}/ingest.pdf`;
    await s.put(key, body, 'application/pdf', body.length);
    const url = await s.signedGetUrl(key, 900, true);
    process.stdout.write(JSON.stringify({ key, sha256: sha(body), url }) + '\n');
    return;
  }

  const written = [];
  try {
    const key = `${prefix}/doc.pdf`;
    written.push(key);
    await s.put(key, Readable.from([body]), 'application/pdf', body.length);
    ok('upload streamed with Content-Length (FV_UPLOAD_MODE=proxy path)');

    const head = await s.head(key);
    assert.equal(head?.size, body.length);
    ok('head: size matches');

    assert.equal(sha(await s.getBuffer(key)), sha(body));
    ok('download: checksum matches');

    const r = await s.getStream(key, 'bytes=1000-5095');
    const part = await drain(r.body);
    assert.equal(part.length, 4096);
    assert.ok(part.equals(body.subarray(1000, 5096)));
    assert.match(r.range || '', new RegExp(`^bytes 1000-5095/${body.length}$`));
    ok('range request: 206 slice and Content-Range (PDF viewer)');

    const multi = `${prefix}/multi.pdf`;
    written.push(multi, `${multi}.parts/1`, `${multi}.parts/2`);
    await s.putPart(multi, 1, body.subarray(0, 100_000), 'application/pdf');
    await s.putPart(multi, 2, body.subarray(100_000), 'application/pdf');
    assert.equal(await s.assembleParts(multi, 2, 'application/pdf'), body.length);
    assert.equal(sha(await s.getBuffer(multi)), sha(body));
    assert.equal(await s.head(`${multi}.parts/1`), null);
    ok('multipart: parts assembled, checksum matches, parts removed');

    const res = await fetch(await s.signedGetUrl(key, 300, true));
    assert.equal(res.status, 200);
    assert.equal(sha(Buffer.from(await res.arrayBuffer())), sha(body));
    ok('signed internal GET URL: downloadable without credentials, checksum matches');
  } finally {
    for (const k of written) await s.delete(k).catch(() => undefined);
  }
  for (const k of written) assert.equal(await s.head(k), null, `object ${k} still exists`);
  ok('delete: every test object removed');
}

main().catch((e) => {
  console.error(`FAIL ${e && e.message ? e.message : e}`);
  process.exit(1);
});
