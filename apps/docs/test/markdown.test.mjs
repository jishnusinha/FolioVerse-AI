import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escapePlaceholders, frontmatter, mapLinks, stripTitle } from '../scripts/lib/markdown.mjs';

test('mapLinks rewrites links and images but not inside code', () => {
  const body = [
    'See [the guide](guide.md#setup) and ![shot](../screenshots/a.png "Home").',
    'Inline `[not](a.md)` stays; [`code text`](b.md) is a link.',
    '```',
    '[fenced](c.md)',
    '```',
  ].join('\n');
  const seen = [];
  const out = mapLinks(body, (l) => {
    seen.push([l.image, l.text, l.href, l.title ?? null]);
    return `<${l.href}>`;
  });
  assert.deepEqual(seen, [
    [false, 'the guide', 'guide.md#setup', null],
    [true, 'shot', '../screenshots/a.png', 'Home'],
    [false, '`code text`', 'b.md', null],
  ]);
  assert.match(out, /`\[not\]\(a\.md\)`/);
  assert.match(out, /\[fenced\]\(c\.md\)/);
});

test('escapePlaceholders keeps HTML tags and code but escapes <name> placeholders', () => {
  const out = escapePlaceholders('Use https://github.com/<org>/<repo> or `<org>`.<br>\n```\n<keep>\n```');
  assert.equal(out, 'Use https://github.com/&lt;org&gt;/&lt;repo&gt; or `<org>`.<br>\n```\n<keep>\n```');
});

test('stripTitle removes the leading H1', () => {
  assert.deepEqual(stripTitle('# Runbooks\n\nBody'), { title: 'Runbooks', body: 'Body' });
  assert.deepEqual(stripTitle('No title'), { title: '', body: 'No title' });
});

test('frontmatter emits nested YAML with quoted strings', () => {
  assert.equal(
    frontmatter({ title: 'A: "b"', skip: undefined, sidebar: { order: 3 } }),
    '---\ntitle: "A: \\"b\\""\nsidebar:\n  order: 3\n---\n',
  );
});
