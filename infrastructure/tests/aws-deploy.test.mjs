import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const AWS = join(ROOT, 'infrastructure', 'aws');
const read = (p) => readFileSync(join(AWS, p), 'utf8').replace(/\r\n/g, '\n');
const code = (src) => src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

const PYTHON = ['python3', 'python'].find((cmd) => {
  const r = spawnSync(cmd, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)']);
  return r.status === 0;
});

const PEM_PRIVATE = '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg\n-----END PRIVATE KEY-----\n';
const PEM_PUBLIC = '-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE\n-----END PUBLIC KEY-----\n';
const valid = () => ({
  _comment: 'ignored',
  POSTGRES_PASSWORD: 'pg-Secret.value~0123456789abcdef',
  REDIS_PASSWORD: 'redis_secret_0123456789abcdef',
  FV_JWT_SECRET: 'jwt$HOME"dollar${NOT_EXPANDED}0123456789abcdef',
  FV_INTERNAL_JWT_PRIVATE_KEY: PEM_PRIVATE,
  FV_INTERNAL_JWT_PUBLIC_KEY: PEM_PUBLIC,
});

function render(secret, extraArgs = []) {
  const dir = mkdtempSync(join(tmpdir(), 'fv-secrets-'));
  const r = spawnSync(PYTHON, [join(AWS, 'scripts', 'render-secrets.py'), '--out-dir', dir, ...extraArgs], {
    input: typeof secret === 'string' ? secret : JSON.stringify(secret),
    encoding: 'utf8',
  });
  const files = {};
  if (r.status === 0) for (const f of readdirSync(dir)) files[f] = readFileSync(join(dir, f), 'utf8');
  rmSync(dir, { recursive: true, force: true });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, files };
}

const envValue = (file, key) => {
  const line = file.split('\n').find((l) => l.startsWith(`${key}=`));
  assert.ok(line, `${key} present`);
  assert.match(line, /^[A-Z_]+='[^']*'$/, `${key} is single-quoted (Compose reads it literally)`);
  return line.slice(key.length + 2, -1);
};

test('render-secrets writes literal single-quoted values, encodes PEM newlines and prints no value', { skip: !PYTHON && 'python not found' }, () => {
  const s = valid();
  const r = render(s);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(Object.keys(r.files).sort(), ['app.env', 'postgres.env', 'redis.env']);
  for (const v of [s.POSTGRES_PASSWORD, s.REDIS_PASSWORD, s.FV_JWT_SECRET, 'MIGHAgEA', 'MFkwEwYH']) {
    assert.ok(!r.out.includes(v), 'no secret value in output');
  }
  const app = r.files['app.env'];
  assert.equal(envValue(app, 'FV_JWT_SECRET'), s.FV_JWT_SECRET, '$ and " survive unchanged');
  assert.equal(envValue(app, 'FV_INTERNAL_JWT_PRIVATE_KEY'), PEM_PRIVATE.trim().replace(/\n/g, '\\n'));
  assert.equal(envValue(app, 'DATABASE_URL'), `postgresql://folioverse:${encodeURIComponent(s.POSTGRES_PASSWORD)}@postgres:5432/folioverse?schema=app`);
  assert.equal(envValue(app, 'REDIS_URL'), `redis://:${s.REDIS_PASSWORD}@redis:6379`);
  assert.equal(envValue(r.files['postgres.env'], 'POSTGRES_PASSWORD'), s.POSTGRES_PASSWORD);
  assert.ok(!app.includes('POSTGRES_PASSWORD='), 'database password reaches apps only inside DATABASE_URL');
  assert.ok(!app.includes('_comment'));
});

test('render-secrets accepts PEMs stored with literal \\n sequences', { skip: !PYTHON && 'python not found' }, () => {
  const s = { ...valid(), FV_INTERNAL_JWT_PRIVATE_KEY: PEM_PRIVATE.replace(/\n/g, '\\n') };
  const r = render(s);
  assert.equal(r.status, 0, r.out);
  assert.equal(envValue(r.files['app.env'], 'FV_INTERNAL_JWT_PRIVATE_KEY'), PEM_PRIVATE.trim().replace(/\n/g, '\\n'));
});

const rejections = [
  ['a single quote', { FV_JWT_SECRET: "has'quote-0123456789abcdef0123456789" }, /single quote/],
  ['an unknown key', { AWS_SECRET_ACCESS_KEY: 'x' }, /unknown key/],
  ['a missing required key', { REDIS_PASSWORD: '' }, /missing required key\(s\): REDIS_PASSWORD/],
  ['a weak database password', { POSTGRES_PASSWORD: 'short' }, /POSTGRES_PASSWORD must be/],
  ['a URL-unsafe database password', { POSTGRES_PASSWORD: 'contains@and/slash-0123456789abcdef' }, /POSTGRES_PASSWORD must be/],
  ['a short JWT secret', { FV_JWT_SECRET: 'too-short' }, /at least 32/],
  ['a non-PEM key', { FV_INTERNAL_JWT_PUBLIC_KEY: 'not-a-pem' }, /SPKI PEM/],
  ['an OpenAI key without a model id', { OPENAI_API_KEY: 'sk-test-not-real' }, /FV_OPENAI_MODEL/],
  ['a non-string value', { GOOGLE_BOOKS_API_KEY: 42 }, /must be a string/],
  ['a newline outside a PEM', { GOOGLE_BOOKS_API_KEY: 'line1\nline2' }, /control character/],
];
for (const [name, patch, message] of rejections) {
  test(`render-secrets rejects ${name} without echoing values`, { skip: !PYTHON && 'python not found' }, () => {
    const s = { ...valid(), ...patch };
    const r = render(s);
    assert.equal(r.status, 1);
    assert.match(r.out, message);
    for (const v of Object.values(patch)) if (typeof v === 'string' && v.length > 3) assert.ok(!r.out.includes(v), 'value not echoed');
    assert.ok(!r.out.includes(s.POSTGRES_PASSWORD));
    assert.deepEqual(r.files, {});
  });
}

test('render-secrets requires SMTP_URL only when mail is enabled', { skip: !PYTHON && 'python not found' }, () => {
  assert.equal(render(valid(), ['--mail-enabled', 'false']).status, 0);
  const r = render(valid(), ['--mail-enabled', 'true']);
  assert.equal(r.status, 1);
  assert.match(r.out, /SMTP_URL/);
  assert.equal(render({ ...valid(), SMTP_URL: 'smtp://u:p@mail.example:587' }, ['--mail-enabled', 'true']).status, 0);
});

test('render-secrets rejects invalid JSON without printing it', { skip: !PYTHON && 'python not found' }, () => {
  const r = render('{"POSTGRES_PASSWORD": "leaky-value-123",');
  assert.equal(r.status, 1);
  assert.ok(!r.out.includes('leaky-value-123'));
});

test('compose: only the edge publishes ports; data binds never create host paths; images come from the manifest', () => {
  const compose = code(read('compose.yml'));
  const services = compose.split('\nservices:\n')[1].split('\nnetworks:\n')[0];
  const blocks = Object.fromEntries(
    services.split(/\n(?=  [a-z-]+:\n)/).map((b) => [b.trim().split(':')[0], b]),
  );
  for (const [name, block] of Object.entries(blocks)) {
    if (name !== 'edge') assert.ok(!/\n {4}ports:/.test(block), `${name} must not publish ports`);
  }
  assert.match(blocks.edge, /- "80:80"/);
  assert.match(blocks.edge, /- "443:443"/);
  const binds = compose.match(/type: bind/g).length;
  assert.equal(compose.match(/create_host_path: false/g).length, binds, 'every bind mount uses create_host_path: false');
  for (const s of ['migrate', 'seed', 'api-http', 'api-worker']) assert.match(blocks[s], /image: \$\{FV_API_IMAGE/);
  for (const s of ['ai-api', 'ai-ingest']) assert.match(blocks[s], /image: \$\{FV_AI_IMAGE/);
  assert.match(blocks.web, /image: \$\{FV_WEB_IMAGE/);
  assert.ok(!/:latest\b/.test(compose));
  assert.match(blocks.migrate, /command: \["node_modules\/\.bin\/prisma", "migrate", "deploy"\]/);
  assert.match(blocks.seed, /command: \["node", "dist\/prisma\/seed\.js"\]/);
  assert.match(blocks['api-http'], /command: \["node", "dist\/src\/main\.js"\]/);
  assert.match(blocks['api-worker'], /command: \["node", "dist\/src\/worker\.js"\]/);
  assert.match(compose, /data:\n {4}internal: true/);
  for (const k of ['COOKIE_SECURE: "true"', 'NODE_ENV: production', 'FV_LAB_FAULTS: "false"', 'STORAGE_PROVIDER: aws', 'FV_UPLOAD_MODE: proxy']) {
    assert.ok(compose.includes(k), k);
  }
  assert.ok(!/STORAGE_(ACCESS|SECRET)_KEY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/.test(compose), 'no explicit AWS credentials');
  assert.ok(!/PASSWORD:\s*\$\{/.test(compose), 'secrets never pass through interpolation');
});

const shellScripts = () =>
  ['scripts', 'hooks'].flatMap((d) => readdirSync(join(AWS, d)).filter((f) => f.endsWith('.sh')).map((f) => `${d}/${f}`));

test('host scripts never delete volumes, prune, trace, or format without the explicit flag', () => {
  for (const f of shellScripts()) {
    const raw = read(f);
    const src = code(raw);
    assert.ok(raw.startsWith('#!/usr/bin/env bash\n'), `${f} has a bash shebang`);
    assert.ok(/set -Eeuo pipefail/.test(src) || /lib\.sh"/.test(src), `${f} uses strict mode`);
    assert.ok(!/down\s+(-v|--volumes)|volume\s+(rm|prune)|system\s+prune/.test(src), `${f} must not remove volumes`);
    assert.ok(!/^\s*set\s+-[a-zA-Z]*x/m.test(src), `${f} must not enable xtrace (would print secrets)`);
    if (f !== 'scripts/prepare-data-volume.sh') assert.ok(!/\bmkfs\b|\bwipefs\s+-a/.test(src), `${f} must not format disks`);
  }
  const prep = code(read('scripts/prepare-data-volume.sh'));
  assert.match(prep, /--format-blank-volume\) FORMAT=true/);
  assert.ok(!/wipefs\s+-a/.test(prep));
});

test('appspec hooks exist and run the deploy steps in order', () => {
  const appspec = read('appspec.yml');
  for (const m of appspec.matchAll(/location: (\S+)/g)) assert.ok(existsSync(join(AWS, m[1])), m[1]);
  const order = ['BeforeInstall', 'AfterInstall', 'ApplicationStart', 'ValidateService'].map((h) => appspec.indexOf(`${h}:`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(order.every((i) => i > 0));
  assert.match(read('hooks/after-install.sh'), /preflight secrets pull/);
  assert.match(read('hooks/application-start.sh'), /data migrate seed app promote/);
  const deploy = read('scripts/deploy.sh');
  assert.match(deploy, /all\) STEPS\+=\(preflight secrets pull data migrate seed app promote validate\)/);
});

test('buildspec builds linux/amd64, checks images before pushing, and packages the bundle without paid tests', () => {
  const b = read('buildspec.yml');
  assert.match(b, /--platform linux\/amd64/);
  assert.ok(b.indexOf('check-images.sh') < b.indexOf('docker push'), 'images are checked before any push');
  assert.match(b, /package-bundle\.sh --out deploy-bundle --release-env release\.env/);
  assert.match(b, /base-directory: deploy-bundle/);
  assert.match(b, /FV_LIVE_PROVIDER_TESTS: "0"/);
  assert.match(b, /OPENAI_API_KEY: ""/);
  assert.match(b, /@sha256:\[0-9a-f\]\{64\}/);
});

test('IAM and CI/CD templates are valid JSON without broad grants', () => {
  const allowedStar = new Set([
    'ecr:GetAuthorizationToken',
    'ec2:DescribeInstances',
    'ec2:DescribeInstanceStatus',
    'tag:GetResources',
    'cloudwatch:DescribeAlarms',
  ]);
  for (const dir of ['iam', 'cicd']) {
    for (const f of readdirSync(join(AWS, dir))) {
      const doc = JSON.parse(read(`${dir}/${f}`));
      if (dir !== 'iam') continue;
      for (const st of doc.Statement) {
        const actions = [st.Action].flat();
        assert.ok(actions.every((a) => !a.endsWith(':*') && a !== '*'), `${f}: no service-wide action wildcard`);
        if (st.Resource === '*') assert.ok(actions.every((a) => allowedStar.has(a)), `${f}: ${actions} on "*"`);
        if (st.Principal?.Service && st.Principal.Service !== 'ec2.amazonaws.com') {
          assert.equal(st.Condition?.StringEquals?.['aws:SourceAccount'], '<ACCOUNT_ID>', `${f}: confused-deputy guard`);
        }
      }
    }
  }
  const pipeline = JSON.parse(read('cicd/pipeline.json')).pipeline;
  assert.equal(pipeline.pipelineType, 'V2');
  assert.equal(pipeline.executionMode, 'QUEUED');
  assert.deepEqual(pipeline.stages.map((s) => s.name), ['Source', 'Build', 'Deploy']);
  const group = JSON.parse(read('cicd/codedeploy-deployment-group.json'));
  assert.equal(group.deploymentConfigName, 'CodeDeployDefault.OneAtATime');
  assert.ok(JSON.parse(read('cicd/codebuild-project.json')).environment.privilegedMode);
});

test('the deployment bundle never ships env or key files', () => {
  const pkg = read('scripts/package-bundle.sh');
  assert.match(pkg, /refusing to package an env or key file/);
  const ignore = readFileSync(join(ROOT, '.dockerignore'), 'utf8');
  for (const p of ['.env', 'node_modules', '.git', '*.pem', '*.tfstate']) assert.ok(ignore.split(/\r?\n/).some((l) => l.includes(p)), p);
});
