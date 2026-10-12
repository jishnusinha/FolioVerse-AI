import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const dir = new URL('../schemas/', import.meta.url);
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
for (const f of readdirSync(dir)) ajv.addSchema(JSON.parse(readFileSync(new URL(f, dir), 'utf8')), f);

const v = (id) => ajv.getSchema(id);

test('all schemas compile', () => {
  for (const f of readdirSync(dir)) assert.ok(ajv.getSchema(f), f);
});

test('event envelope accepts a token delta and rejects unknown types', () => {
  const ok = { schemaVersion: 1, type: 'token.delta', seq: 3, ts: new Date().toISOString(), data: { text: 'hi' } };
  assert.ok(v('event-envelope.schema.json')(ok));
  assert.equal(v('event-envelope.schema.json')({ ...ok, type: 'nope' }), false);
});

test('source anchor requires sourceVersionId and selectors', () => {
  const val = v('source-anchor.schema.json');
  assert.ok(val({ sourceVersionId: 'sv1', selectors: { page: 2, bbox: [1, 2, 3, 4], textQuote: { exact: 'x' } }, state: 'EXACT' }));
  assert.equal(val({ selectors: {} }), false);
  assert.equal(val({ sourceVersionId: 'sv1', selectors: { bbox: [1, 2] } }), false);
});

test('run spec validates graph names', () => {
  const val = v('run-spec.schema.json');
  assert.ok(val({ graph: 'grounded_qa', input: { question: 'q' }, scope: { sourceVersionIds: ['a'] } }));
  assert.equal(val({ graph: 'free_for_all', input: {} }), false);
});

test('pricing fixtures are well-formed', () => {
  const { cases } = JSON.parse(readFileSync(new URL('../fixtures/pricing-cases.json', import.meta.url), 'utf8'));
  assert.ok(cases.length >= 25);
  for (const c of cases) {
    assert.match(c.expected.amount, /^\d+\.\d{8}$/, c.name);
    assert.ok(['FINALIZED', 'FINAL_ESTIMATED'].includes(c.expected.status), c.name);
    if (c.usage.cachedInput) assert.ok(c.usage.cachedInput <= c.usage.input, c.name);
    if (c.usage.reasoning) assert.ok(c.usage.reasoning <= c.usage.output, c.name);
  }
});
