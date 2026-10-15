import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1');

/** Unset and empty are the same: compose and env files cannot express "unset" for a declared key. */
const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());
const optionalBool = z.preprocess((v) => (v === '' ? undefined : v), bool.optional());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_ORIGIN: z.string().default('http://localhost:8080'),
  /** Reverse proxies in front of the API (web Caddy = 1; an HTTPS edge in front of it = 2). Sets req.ip. */
  FV_TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  FV_JWT_SECRET: z.string().min(32, 'FV_JWT_SECRET must be at least 32 characters'),
  FV_INTERNAL_JWT_PRIVATE_KEY: z.string().min(1),
  FV_INTERNAL_JWT_PUBLIC_KEY: z.string().min(1),
  FV_AI_API_URL: z.string().default('http://localhost:8000'),
  FV_AI_INGEST_URL: z.string().default('http://localhost:8001'),
  /**
   * s3-compatible: SeaweedFS/MinIO locally, or GCS's XML API with HMAC keys; needs STORAGE_ENDPOINT.
   * aws: Amazon S3; the SDK picks the regional endpoint, and credentials come from the default provider
   * chain (EC2 instance role) unless both STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY are set.
   */
  STORAGE_PROVIDER: z.enum(['s3-compatible', 'aws']).default('s3-compatible'),
  STORAGE_ENDPOINT: optionalString,
  STORAGE_PUBLIC_ENDPOINT: optionalString,
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_BUCKET: z.string().default('folioverse'),
  STORAGE_ACCESS_KEY: optionalString,
  STORAGE_SECRET_KEY: optionalString,
  STORAGE_FORCE_PATH_STYLE: optionalBool,
  FV_UPLOAD_MODE: z.enum(['signed', 'proxy']).default('proxy'),
  FV_MAX_UPLOAD_MB: z.coerce.number().default(64),
  /** false: no email is sent (verification, password reset, invitations); the API logs the skipped subject. */
  FV_MAIL_ENABLED: bool.default(true),
  SMTP_URL: z.string().default('smtp://localhost:1025'),
  MAIL_FROM: z.string().default('FolioVerse <no-reply@folioverse.local>'),
  COOKIE_SECURE: bool.default(false),
  FV_ALLOW_REGISTRATION: bool.default(true),
  FV_DEFAULT_MONTHLY_BUDGET: z.string().default('5.00'),
  FV_LAB_FAULTS: bool.default(false),
  FV_METADATA_OPEN_LIBRARY: bool.default(false),
  FV_METADATA_GOOGLE_BOOKS: bool.default(false),
  GOOGLE_BOOKS_API_KEY: z.string().optional(),
  FV_DEMO_CATALOG: bool.default(false),
  FV_REC_CATALOG: z.string().optional(),
  FV_OPENAI_MODEL: z.string().optional(),
  FV_OLLAMA_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  FV_SEED_ADMIN_EMAIL: z.string().optional(),
  /** OpenAI admin key for the Costs API (reconciliation only; never used for inference). */
  OPENAI_ADMIN_KEY: z.string().optional(),
  /** Cloud Billing export table `project.dataset.table`; enables the GCP infrastructure cost import. */
  FV_GCP_BILLING_TABLE: z.string().optional(),
  FV_GCP_PROJECT: z.string().optional(),
  FV_RECON_TOLERANCE_USD: z.string().regex(/^\d+(\.\d+)?$/).default('0.01'),
  FV_ANOMALY_Z: z.coerce.number().positive().default(3),
  FV_ANOMALY_MIN_USD: z.coerce.number().nonnegative().default(0.01),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
});

const validated = schema.superRefine((e, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (!!e.STORAGE_ACCESS_KEY !== !!e.STORAGE_SECRET_KEY) {
    issue('STORAGE_ACCESS_KEY', 'STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY must be set together or both left empty');
  }
  if (e.STORAGE_PROVIDER === 's3-compatible' && e.NODE_ENV === 'production') {
    if (!e.STORAGE_ENDPOINT) issue('STORAGE_ENDPOINT', 'required when STORAGE_PROVIDER=s3-compatible in production (use STORAGE_PROVIDER=aws for Amazon S3)');
    if (!e.STORAGE_ACCESS_KEY) issue('STORAGE_ACCESS_KEY', 'required when STORAGE_PROVIDER=s3-compatible in production');
  }
});

export type Env = z.infer<typeof schema>;

export interface StorageConfig {
  provider: Env['STORAGE_PROVIDER'];
  /** undefined: the AWS SDK resolves the regional S3 endpoint. */
  endpoint?: string;
  publicEndpoint?: string;
  region: string;
  forcePathStyle: boolean;
  /** undefined: the AWS SDK default credential provider chain (env, profile, container, EC2 instance role). */
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

/** Local emulator credentials, used only outside production when an s3-compatible endpoint has no keys. */
const DEV_STORAGE_KEYS = { accessKeyId: 'folioverse', secretAccessKey: 'folioverse-secret' };

export function storageConfig(e: Env = env()): StorageConfig {
  const explicit =
    e.STORAGE_ACCESS_KEY && e.STORAGE_SECRET_KEY ? { accessKeyId: e.STORAGE_ACCESS_KEY, secretAccessKey: e.STORAGE_SECRET_KEY } : undefined;
  if (e.STORAGE_PROVIDER === 'aws') {
    return {
      provider: 'aws',
      endpoint: e.STORAGE_ENDPOINT,
      publicEndpoint: e.STORAGE_PUBLIC_ENDPOINT,
      region: e.STORAGE_REGION,
      forcePathStyle: e.STORAGE_FORCE_PATH_STYLE ?? false,
      credentials: explicit,
    };
  }
  return {
    provider: 's3-compatible',
    endpoint: e.STORAGE_ENDPOINT ?? 'http://localhost:9000',
    publicEndpoint: e.STORAGE_PUBLIC_ENDPOINT,
    region: e.STORAGE_REGION,
    forcePathStyle: e.STORAGE_FORCE_PATH_STYLE ?? true,
    credentials: explicit ?? (e.NODE_ENV === 'production' ? undefined : DEV_STORAGE_KEYS),
  };
}

let cached: Env | null = null;

/** Native dev: load the monorepo root .env (does not override variables already set). */
export function loadDotEnv() {
  if (process.env.NODE_ENV === 'test' || process.env.FV_SKIP_DOTENV) return;
  for (const p of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
    if (existsSync(p)) {
      process.loadEnvFile(p);
      return;
    }
  }
}

/** Validates process.env once. Errors name the variable, never its value. */
export function env(): Env {
  if (cached) return cached;
  loadDotEnv();
  const parsed = validated.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache() {
  cached = null;
}

export const pem = (v: string) => v.replace(/\\n/g, '\n');
