import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

/** Applies migrations to the integration database (folioverse_test) once per run. */
export default async function globalSetup() {
  const url = process.env.DATABASE_URL ?? 'postgresql://folioverse:folioverse@localhost:5432/folioverse_test?schema=app';
  if (!/folioverse_test/.test(url)) throw new Error('Integration tests must run against the folioverse_test database');
  execSync('npx prisma migrate deploy', {
    cwd: resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: url, FV_SKIP_DOTENV: '1' },
    stdio: 'inherit',
  });
}
