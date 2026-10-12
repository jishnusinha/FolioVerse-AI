import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_ORIGIN: z.string().default('http://localhost:8080'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  FV_JWT_SECRET: z.string().min(32, 'FV_JWT_SECRET must be at least 32 characters'),
  FV_INTERNAL_JWT_PRIVATE_KEY: z.string().min(1),
  FV_INTERNAL_JWT_PUBLIC_KEY: z.string().min(1),
  FV_AI_API_URL: z.string().default('http://localhost:8000'),
  FV_AI_INGEST_URL: z.string().default('http://localhost:8001'),
  STORAGE_ENDPOINT: z.string().default('http://localhost:9000'),
  STORAGE_PUBLIC_ENDPOINT: z.string().optional(),
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_BUCKET: z.string().default('folioverse'),
  STORAGE_ACCESS_KEY: z.string().default('folioverse'),
  STORAGE_SECRET_KEY: z.string().default('folioverse-secret'),
  STORAGE_FORCE_PATH_STYLE: bool.default(true),
  FV_UPLOAD_MODE: z.enum(['signed', 'proxy']).default('proxy'),
  FV_MAX_UPLOAD_MB: z.coerce.number().default(64),
  SMTP_URL: z.string().default('smtp://localhost:1025'),
  MAIL_FROM: z.string().default('FolioVerse <no-reply@folioverse.local>'),
  COOKIE_SECURE: bool.default(false),
  FV_ALLOW_REGISTRATION: bool.default(true),
  FV_DEFAULT_MONTHLY_BUDGET: z.string().default('5.00'),
  FV_LAB_FAULTS: bool.default(false),
  FV_OPENAI_MODEL: z.string().optional(),
  FV_OLLAMA_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  FV_SEED_ADMIN_EMAIL: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
});

export type Env = z.infer<typeof schema>;

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
  const parsed = schema.safeParse(process.env);
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
