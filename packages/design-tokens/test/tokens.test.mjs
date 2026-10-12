import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTokens } from '../build.mjs';

const tokens = JSON.parse(readFileSync(new URL('../tokens.json', import.meta.url), 'utf8'));
const out = buildTokens(tokens);

test('light theme carries brand values from the visual handoff', () => {
  assert.match(out.css, /--fv-bg:#F6F5F1;/);
  assert.match(out.css, /--fv-accent:#5A4BD1;/);
  assert.match(out.css, /--fv-ai:#6A4CE0;/);
});

test('dark theme and studio scope override surfaces', () => {
  assert.match(out.css, /\[data-theme=dark\],\.studio\{[^}]*--fv-bg:#111216;/);
  assert.match(out.css, /\[data-theme=dark\],\.studio\{[^}]*--fv-accent:#9488FF;/);
  assert.match(out.css, /\.studio\{[^}]*--fv-bg:#121318;/);
});

test('layout dimensions match the shell spec', () => {
  for (const [k, v] of [
    ['rail', '60px'],
    ['rail-expanded', '224px'],
    ['topbar', '56px'],
    ['toolbar', '46px'],
    ['context', '260px'],
    ['inspector', '330px'],
    ['drawer', '440px'],
    ['measure-editor', '64ch'],
    ['measure-reader', '62ch'],
  ]) {
    assert.ok(out.css.includes(`--fv-${k}:${v};`), `${k} should be ${v}`);
  }
});

test('every dark color has a light counterpart', () => {
  for (const k of Object.keys(tokens.color.dark)) assert.ok(k in tokens.color.light, k);
});

test('tailwind theme maps colors to css variables', () => {
  assert.match(out.theme, /--color-fv-accent: var\(--fv-accent\);/);
  assert.match(out.theme, /@theme inline/);
});
