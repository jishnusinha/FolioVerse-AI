import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { cell, operations, referenceMarkdown, typeOf } from '../scripts/lib/openapi.mjs';

const root = new URL('../../../', import.meta.url);
const load = (name) => JSON.parse(readFileSync(new URL(`packages/contracts/openapi/${name}`, root), 'utf8'));

test('typeOf renders refs as same-page links and composes unions, arrays and enums', () => {
  assert.equal(typeOf({ $ref: '#/components/schemas/RunScopeDto' }), '[RunScopeDto](#runscopedto)');
  assert.equal(typeOf({ type: 'array', items: { type: 'string' } }), 'string[]');
  assert.equal(typeOf({ anyOf: [{ type: 'integer' }, { type: 'null' }] }), 'integer or null');
  assert.equal(typeOf({ enum: ['md', 'docx'], type: 'string' }), '`md` / `docx`');
  assert.equal(typeOf({ type: 'string', format: 'uuid' }), 'string (uuid)');
  assert.equal(typeOf(undefined), 'any');
});

test('cell escapes pipes and newlines for tables', () => {
  assert.equal(cell('a|b\nc'), 'a\\|b c');
});

test('referenceMarkdown groups operations and documents parameters, bodies and schemas', () => {
  const doc = {
    openapi: '3.0.0',
    info: { version: '1' },
    paths: {
      '/api/things/{id}': {
        get: { operationId: 'Things_get', tags: ['things'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: '' } } },
        patch: {
          operationId: 'Things_update',
          tags: ['things'],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateDto' } } } },
          responses: { 200: { description: 'ok' } },
        },
      },
    },
    components: { schemas: { UpdateDto: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 5 } } } } },
  };
  const md = referenceMarkdown(doc, { groupOf: (_p, op) => op.tags[0] });
  assert.match(md, /^## things$/m);
  assert.match(md, /^### `GET \/api\/things\/\{id\}`$/m);
  assert.match(md, /\| `id` \| path \| string \| yes \|/);
  assert.match(md, /Request body \(`application\/json`, required\): \[UpdateDto\]\(#updatedto\)/);
  assert.match(md, /^### UpdateDto$/m);
  assert.match(md, /\| `name` \| string \| yes \| max length `5` \|/);
  assert.doesNotMatch(md, /\n{3,}/);
});

test('the committed API documents render every operation', () => {
  for (const [name, groupOf] of [
    ['api.json', (_p, op) => op.tags?.[0] ?? 'other'],
    ['ai.json', (p) => p.split('/')[2] ?? 'health'],
  ]) {
    const doc = load(name);
    const ops = operations(doc, groupOf);
    const md = referenceMarkdown(doc, { groupOf });
    assert.ok(ops.length > 10, name);
    for (const o of ops) assert.ok(md.includes(`### \`${o.method} ${o.path}\``), `${name}: ${o.method} ${o.path}`);
  }
});

test('only explicitly documented query parameters are required in the API document', () => {
  const required = operations(load('api.json'), () => '')
    .flatMap((o) => (o.op.parameters ?? []).filter((p) => p.in === 'query' && p.required).map((p) => `${o.op.operationId}.${p.name}`));
  assert.deepEqual(required, ['ManuscriptsController_export.format']);
});
