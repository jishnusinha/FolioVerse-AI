import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { sync } from '../scripts/sync-content.mjs';

const OUT = fileURLToPath(new URL('../src/content/docs', import.meta.url));

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
}

test('sync generates every section and leaves no repository-relative links', () => {
  const { pages } = sync();
  assert.ok(pages >= 15);
  for (const rel of ['index.md', 'start/user-guide.md', 'reference/api.md', 'reference/ai-service.md', 'reference/data-model.md', 'runbooks/index.md', 'project/status.md', 'project/decision-log.md']) {
    assert.ok(existsSync(join(OUT, rel)), rel);
  }
  for (const file of files(OUT)) {
    const text = readFileSync(file, 'utf8');
    assert.match(text, /^---\ntitle: /, file);
    let fence = false;
    for (const line of text.split('\n')) {
      if (line.startsWith('```')) fence = !fence;
      if (fence) continue;
      for (const m of line.replace(/`[^`]*`/g, '').matchAll(/\]\(([^)\s]+)/g)) {
        assert.match(m[1], /^(\/|#|https?:|mailto:)/, `${file}: ${m[1]}`);
      }
    }
  }
});

test('guide pages carry status badges derived from the status file', () => {
  sync();
  const guide = readFileSync(join(OUT, 'start/user-guide.md'), 'utf8');
  assert.match(guide, /<span class="fv-badge" data-kind="(implemented|planned)"/);
  assert.match(guide, /data-kind="blocked"[^>]*>Blocked: OpenAI API key</);
  assert.match(guide, /:::note\[DEMO data\]/);
});
