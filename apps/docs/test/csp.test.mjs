import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { inlineScripts, policy, sha256 } from '../scripts/csp.mjs';

test('inlineScripts returns only inline executable scripts', () => {
  const html = '<script>a()</script><script type="module" src="/x.js"></script><script type="application/ld+json">{}</script><script type="module">b()</script>';
  assert.deepEqual(inlineScripts(html), ['a()', 'b()']);
});

test('sha256 produces a CSP hash source of the exact script text', () => {
  const expected = createHash('sha256').update('\n\ta()\n', 'utf8').digest('base64');
  assert.equal(sha256('\n\ta()\n'), `'sha256-${expected}'`);
});

test('policy allows hashed scripts and Pagefind WebAssembly but no inline script', () => {
  const csp = policy(new Set(["'sha256-b'", "'sha256-a'"]));
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval' 'sha256-a' 'sha256-b';/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.match(csp, /frame-ancestors 'none'/);
});
