import { S3Client } from '@aws-sdk/client-s3';
import { env, resetEnvCache, storageConfig } from '../../src/config/env';
import { classifyBucketError, StorageConfigError, StorageService } from '../../src/infra/storage.service';

const KEYS = [
  'STORAGE_PROVIDER',
  'STORAGE_ENDPOINT',
  'STORAGE_PUBLIC_ENDPOINT',
  'STORAGE_REGION',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY',
  'STORAGE_SECRET_KEY',
  'STORAGE_FORCE_PATH_STYLE',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_PROFILE',
  'NODE_ENV',
  'FV_SKIP_DOTENV',
];
const saved: Record<string, string | undefined> = {};

function withEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCache();
}

const s3Error = (name: string, status?: number) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) if (k !== 'NODE_ENV') delete process.env[k];
  // A developer's root .env must not leak in when a test switches NODE_ENV away from 'test'.
  process.env.FV_SKIP_DOTENV = '1';
  resetEnvCache();
});
afterEach(() => {
  jest.restoreAllMocks();
  withEnv(saved);
});

describe('storage configuration', () => {
  it('keeps the local emulator defaults for s3-compatible outside production', () => {
    const c = storageConfig(env());
    expect(c).toMatchObject({ provider: 's3-compatible', endpoint: 'http://localhost:9000', forcePathStyle: true });
    expect(c.credentials?.accessKeyId).toBe('folioverse');
  });

  it('uses the SDK endpoint, virtual-host addressing and the default credential chain for aws', () => {
    withEnv({ STORAGE_PROVIDER: 'aws', STORAGE_REGION: 'ap-south-1', STORAGE_ENDPOINT: '' });
    const c = storageConfig(env());
    expect(c).toMatchObject({ provider: 'aws', region: 'ap-south-1', forcePathStyle: false });
    expect(c.endpoint).toBeUndefined();
    expect(c.credentials).toBeUndefined();
  });

  it('accepts an explicit key pair for aws', () => {
    withEnv({ STORAGE_PROVIDER: 'aws', STORAGE_ACCESS_KEY: 'AKIDTEST', STORAGE_SECRET_KEY: 'not-a-real-secret' });
    expect(storageConfig(env()).credentials).toEqual({ accessKeyId: 'AKIDTEST', secretAccessKey: 'not-a-real-secret' });
  });

  it.each([
    ['access key only', { STORAGE_ACCESS_KEY: 'AKIDTEST' }],
    ['secret key only', { STORAGE_SECRET_KEY: 'super-secret-value' }],
  ])('rejects a partial key pair (%s) without echoing the value', (_label, vars) => {
    withEnv({ STORAGE_PROVIDER: 'aws', ...vars });
    expect(() => env()).toThrow(/STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY must be set together/);
    try {
      env();
    } catch (e) {
      expect((e as Error).message).not.toMatch(/super-secret-value|AKIDTEST/);
    }
  });

  it('requires an endpoint and keys for s3-compatible in production', () => {
    withEnv({ NODE_ENV: 'production' });
    expect(() => env()).toThrow(/STORAGE_ENDPOINT: required when STORAGE_PROVIDER=s3-compatible in production/);
  });
});

describe('bucket errors', () => {
  const cfg = { provider: 'aws' as const, region: 'ap-south-1' };
  it.each([
    [s3Error('NotFound', 404), 'missing-bucket', /does not exist/],
    [s3Error('Forbidden', 403), 'access-denied', /s3:ListBucket/],
    [s3Error('PermanentRedirect', 301), 'wrong-region', /STORAGE_REGION=ap-south-1/],
    [Object.assign(new Error('Could not load credentials from any providers'), { name: 'CredentialsProviderError' }), 'no-credentials', /hop limit to 2/],
    [s3Error('TimeoutError'), 'unreachable', /TimeoutError/],
  ])('classifies %s', (err, reason, message) => {
    const r = classifyBucketError(err, 'fv-docs', cfg);
    expect(r).toBeInstanceOf(StorageConfigError);
    expect(r.reason).toBe(reason);
    expect(r.message).toMatch(message);
  });
});

describe('ensureBucket', () => {
  it('never creates a bucket for aws, even when it is missing', async () => {
    withEnv({ STORAGE_PROVIDER: 'aws', STORAGE_REGION: 'ap-south-1', STORAGE_BUCKET: 'fv-docs', AWS_ACCESS_KEY_ID: 'AKIDTEST', AWS_SECRET_ACCESS_KEY: 'x' });
    const send = jest.spyOn(S3Client.prototype, 'send').mockRejectedValue(s3Error('NotFound', 404) as never);
    await expect(new StorageService().ensureBucket()).rejects.toMatchObject({ reason: 'missing-bucket' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not attempt CreateBucket after an access error', async () => {
    const send = jest.spyOn(S3Client.prototype, 'send').mockRejectedValue(s3Error('Forbidden', 403) as never);
    await expect(new StorageService().ensureBucket()).rejects.toMatchObject({ reason: 'access-denied' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('creates a missing bucket only on a local s3-compatible emulator', async () => {
    const send = jest
      .spyOn(S3Client.prototype, 'send')
      .mockRejectedValueOnce(s3Error('NotFound', 404) as never)
      .mockResolvedValueOnce({} as never);
    await new StorageService().ensureBucket();
    expect(send).toHaveBeenCalledTimes(2);
    expect((send.mock.calls[1][0] as { constructor: { name: string } }).constructor.name).toBe('CreateBucketCommand');
  });
});

describe('signed internal GET URLs', () => {
  it('signs with the default credential chain against the regional virtual-host endpoint', async () => {
    withEnv({ STORAGE_PROVIDER: 'aws', STORAGE_REGION: 'ap-south-1', STORAGE_BUCKET: 'fv-docs', AWS_ACCESS_KEY_ID: 'AKIDCHAIN', AWS_SECRET_ACCESS_KEY: 'x' });
    const url = new URL(await new StorageService().signedGetUrl('ws/1/uploads/2/a.pdf', 1800));
    expect(url.host).toBe('fv-docs.s3.ap-south-1.amazonaws.com');
    expect(url.pathname).toBe('/ws/1/uploads/2/a.pdf');
    expect(url.searchParams.get('X-Amz-Credential')).toMatch(/^AKIDCHAIN\/\d{8}\/ap-south-1\/s3\/aws4_request$/);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('1800');
  });

  it('keeps path-style URLs on the configured endpoint for local emulators', async () => {
    withEnv({ STORAGE_ENDPOINT: 'http://storage:9000', STORAGE_BUCKET: 'folioverse' });
    const url = new URL(await new StorageService().signedGetUrl('k.pdf'));
    expect(`${url.host}${url.pathname}`).toBe('storage:9000/folioverse/k.pdf');
  });
});
