// Fails when committed generated artifacts are out of date or fixtures violate schemas.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'fv-contracts-'));
execFileSync(process.execPath, [join(root, 'scripts/generate.mjs'), '--out', tmp], { stdio: 'inherit' });

let failed = false;
for (const f of readdirSync(tmp)) {
  const committed = join(root, 'generated', f);
  const fresh = readFileSync(join(tmp, f), 'utf8');
  if (!existsSync(committed) || readFileSync(committed, 'utf8') !== fresh) {
    console.error(`contracts:check: generated/${f} is stale. Run "pnpm contracts:gen" and commit.`);
    failed = true;
  }
}
const testFiles = readdirSync(join(root, 'test'))
  .filter((f) => f.endsWith('.test.mjs'))
  .map((f) => join(root, 'test', f));
execFileSync(process.execPath, ['--test', ...testFiles], { stdio: 'inherit' });
if (failed) process.exit(1);
console.log('contracts:check OK');
