import { test, expect } from './fixtures.js';
import { DEMO_USER } from '../src/test/fakeApi.js';

test.describe('auth and upload (fake API)', () => {
  test.use({ apiOptions: { signedIn: false, advance: true } });

  test.beforeEach(async ({ page }) => {
    page.on('pageerror', (e) => {
      throw e;
    });
  });

  test('register, onboard, upload, and watch ingestion reach Ready', async ({ page, fakeApi }) => {
    fakeApi.db.user.email = 'taken@example.test';
    await page.goto('/app/knowledge');
    await expect(page).toHaveURL(/\/auth\/login\?next=%2Fapp%2Fknowledge$/);
    await page.getByRole('link', { name: 'Create one' }).click();

    await page.getByLabel(/^Name/).fill('Ada Lovelace');
    await page.getByLabel(/^Email/).fill('ada@example.test');
    await page.getByLabel(/^Password/).fill('long-enough-password');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/app\/knowledge$/);

    await page.getByRole('link', { name: /Project Atlas/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Project Atlas' })).toBeVisible();
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Upload documents' });
    await dialog.getByLabel('Choose files').setInputFiles([
      { name: 'Field Notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Field notes\n\nDEMO content.') },
      { name: 'payload.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') },
    ]);
    await expect(dialog.getByText('Not allowed')).toBeVisible();
    await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(dialog.getByText('Preview ready')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    const row = page.getByRole('row', { name: /Field Notes\.md/ });
    await expect(row).toBeVisible();
    await expect(row.getByTitle(/· READY$/)).toBeVisible({ timeout: 20_000 });
    expect(fakeApi.db.log.filter((l) => l.endsWith('/content'))).toHaveLength(1);
  });

  test('sign in, survive an expired access token, and sign out', async ({ page, fakeApi }) => {
    await page.goto('/auth/login?next=/app/knowledge/trash');
    await page.getByLabel(/^Email/).fill(DEMO_USER.email);
    await page.getByLabel(/^Password/).fill(DEMO_USER.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Trash' })).toBeVisible();

    fakeApi.db.accessExpired = true;
    await page.getByRole('link', { name: 'Back to projects' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Folio Knowledge' })).toBeVisible();
    await expect(page.getByText('Project Atlas')).toBeVisible();
    expect(fakeApi.db.refreshes).toBe(1);

    await page.getByRole('button', { name: /^Account:/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/auth\/login$/);
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });

  test('wrong password shows an error without leaving the page', async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByLabel(/^Email/).fill(DEMO_USER.email);
    await page.getByLabel(/^Password/).fill('wrong-password-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('Invalid email or password');
    await expect(page).toHaveURL(/\/auth\/login$/);
  });
});
