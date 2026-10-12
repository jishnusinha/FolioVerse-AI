import { generateKeyPairSync } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.FV_JWT_SECRET ??= 'test-secret-'.padEnd(48, 'x');
if (!process.env.FV_INTERNAL_JWT_PRIVATE_KEY) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  process.env.FV_INTERNAL_JWT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  process.env.FV_INTERNAL_JWT_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
}
process.env.DATABASE_URL ??= 'postgresql://folioverse:folioverse@localhost:5432/folioverse_test?schema=app';
process.env.REDIS_URL ??= 'redis://localhost:6379/1';
process.env.FV_UPLOAD_MODE = 'proxy';
process.env.STORAGE_BUCKET ??= 'folioverse-test';
process.env.FV_AI_API_URL ??= 'http://127.0.0.1:9';
process.env.FV_AI_INGEST_URL ??= 'http://127.0.0.1:9';
