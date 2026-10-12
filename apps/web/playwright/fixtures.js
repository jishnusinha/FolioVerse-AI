import { test as base, expect } from '@playwright/test';
import { FAKE_CSRF, createFakeApi } from '../src/test/fakeApi.js';

/**
 * Every page gets `/api/**` answered by the in-memory fake API (DEMO data, no backend, no network).
 * Override seed options per file with `test.use({ apiOptions: { signedIn: false } })`.
 */
export const test = base.extend({
  apiOptions: [{}, { option: true }],
  fakeApi: [
    async ({ page, context, baseURL, apiOptions }, use) => {
      const fake = createFakeApi(apiOptions);
      if (baseURL) await context.addCookies([{ name: 'fv_csrf', value: FAKE_CSRF, url: baseURL }]);
      await page.route('**/api/**', async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        const type = req.headers()['content-type'] ?? '';
        const body = type.includes('json') ? req.postDataJSON() : undefined;
        const res = fake.handle(req.method(), url.pathname + url.search, body, req.headers());
        await route.fulfill({
          status: res.status,
          headers: res.headers,
          body: res.body == null ? '' : typeof res.body === 'string' ? res.body : JSON.stringify(res.body),
        });
      });
      await use(fake);
    },
    { auto: true },
  ],
});

export { expect };
