// Generates TypeScript artifacts from the JSON Schemas and committed OpenAPI documents.
//   generated/api-types.ts  <- schemas/*.schema.json (consumed by apps/api)
//   generated/web.d.ts      <- openapi/api.json (consumed by apps/web via JSDoc checkJs)
// Usage: node scripts/generate.mjs [--out <dir>]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';
import openapiTS, { astToString } from 'openapi-typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outIdx = process.argv.indexOf('--out');
const outDir = outIdx > 0 ? resolve(process.argv[outIdx + 1]) : join(root, 'generated');
mkdirSync(outDir, { recursive: true });

const schemaDir = join(root, 'schemas');
const files = readdirSync(schemaDir).filter((f) => f.endsWith('.schema.json')).sort();
const schemas = Object.fromEntries(files.map((f) => [f, JSON.parse(readFileSync(join(schemaDir, f), 'utf8'))]));

// Resolve "x.schema.json#/..." refs locally so the compiler never touches the network.
const resolver = {
  order: 1,
  canRead: /\.schema\.json/,
  read: (file) => {
    const name = file.url.split('/').pop().split('#')[0];
    return structuredClone(schemas[name]);
  },
};

let ts = '/* Generated from packages/contracts/schemas by scripts/generate.mjs. Do not edit. */\n/* eslint-disable */\n';
const seen = new Set();
for (const f of files) {
  const schema = structuredClone(schemas[f]);
  if (!schema.type && schema.$defs) {
    schema.type = 'object';
    schema.properties = Object.fromEntries(Object.keys(schema.$defs).map((k) => [k, { $ref: `#/$defs/${k}` }]));
    schema.additionalProperties = false;
  }
  const out = await compile(schema, schema.title || f, {
    bannerComment: '',
    cwd: schemaDir,
    declareExternallyReferenced: true,
    additionalProperties: false,
    unreachableDefinitions: true,
    $refOptions: { resolve: { file: resolver, http: false } },
    format: false,
  });
  // De-duplicate declarations emitted by multiple files.
  const blocks = out.split(/\n(?=export )/);
  for (const b of blocks) {
    const m = b.match(/^export (?:interface|type) (\w+)/);
    if (m) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
    }
    ts += b.trimEnd() + '\n';
  }
}
writeFileSync(join(outDir, 'api-types.ts'), ts);

const openapiPath = join(root, 'openapi', 'api.json');
if (existsSync(openapiPath)) {
  const doc = JSON.parse(readFileSync(openapiPath, 'utf8'));
  const ast = await openapiTS(doc);
  writeFileSync(
    join(outDir, 'web.d.ts'),
    '/* Generated from openapi/api.json by scripts/generate.mjs. Do not edit. */\n' + astToString(ast),
  );
}
console.log(`contracts: generated into ${outDir}`);
