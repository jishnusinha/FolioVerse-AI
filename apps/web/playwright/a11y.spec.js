import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures.js';
import { ALL_ROUTES, SECTIONS } from '../src/app/routes.js';
import { EPUB, FULL_DEMO, PDF, urlFor } from './sample-urls.js';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const SIGNED_OUT = new Set(['login', 'register', 'forgot', 'reset', 'verify']);

/** Renders each violation as `rule (impact): selector [fg on bg = ratio]` so a failure says what to fix. */
const describe = (violations) =>
  violations.flatMap((v) =>
    v.nodes.map((n) => {
      const c = n.any.find((x) => x.data?.contrastRatio)?.data;
      return `${v.id} (${v.impact}): ${n.target.join(' ')}${c ? ` [${c.fgColor} on ${c.bgColor} = ${c.contrastRatio}]` : ''}`;
    }),
  );

async function audit(page) {
  // epub.js and pdf.js render third-party documents inside an iframe or canvas; their content is the book's, not ours.
  const results = await new AxeBuilder({ page }).withTags(WCAG).exclude('.epub-host iframe').analyze();
  return describe(results.violations);
}

async function settle(page) {
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
}

test.describe('accessibility (axe, WCAG 2.2 AA)', () => {
  test.use({ apiOptions: FULL_DEMO });

  for (const route of ALL_ROUTES.filter((r) => !SIGNED_OUT.has(r.id))) {
    test(`${route.id} has no violations`, async ({ page, fakeApi }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(urlFor(route.id, fakeApi));
      await settle(page);
      expect(await audit(page)).toEqual([]);
    });
  }

  for (const s of SECTIONS) {
    test(`${s.id} has no violations in the dark theme`, async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('fv-theme', JSON.stringify({ state: { theme: 'dark' }, version: 0 })));
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(s.to);
      await settle(page);
      expect(await audit(page)).toEqual([]);
    });
  }

  test('mobile shell has no violations', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app');
    await settle(page);
    expect(await audit(page)).toEqual([]);
  });
});

test.describe('accessibility signed out', () => {
  test.use({ apiOptions: { signedIn: false } });

  for (const route of ALL_ROUTES.filter((r) => SIGNED_OUT.has(r.id))) {
    test(`${route.id} has no violations`, async ({ page, fakeApi }) => {
      await page.goto(urlFor(route.id, fakeApi));
      await settle(page);
      expect(await audit(page)).toEqual([]);
    });
  }
});

/** Walks the page with Tab only; every stop must be a visible element with a visible focus indicator. */
async function tabWalk(page, max = 60) {
  const stops = [];
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      // SVG graph nodes show focus by thickening their shape's stroke (>= 3px) instead of an outline.
      const shape = el instanceof SVGElement ? el.querySelector('rect, circle, path') : null;
      const ring =
        (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
        (cs.boxShadow && cs.boxShadow !== 'none') ||
        (shape && parseFloat(getComputedStyle(shape).strokeWidth) >= 3);
      return {
        key: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}|${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40)}`,
        visible: r.width > 0 && r.height > 0,
        ring,
        inIframe: el.tagName === 'IFRAME',
      };
    });
    if (!info) break;
    if (stops.length && info.key === stops[0].key) break;
    stops.push(info);
  }
  return stops;
}

test.describe('keyboard only', () => {
  test.use({ apiOptions: { pdfBytes: PDF, epubBytes: EPUB } });

  for (const s of SECTIONS) {
    test(`${s.id}: every Tab stop is visible and shows focus`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(s.to);
      await settle(page);
      const stops = await tabWalk(page);
      expect(stops.length).toBeGreaterThan(5);
      expect(stops.filter((x) => !x.inIframe && (!x.visible || !x.ring)).map((x) => x.key)).toEqual([]);
    });
  }

  test('every section is reachable from the keyboard alone', async ({ page }) => {
    await page.goto('/app');
    await settle(page);
    for (const s of SECTIONS.filter((x) => x.to !== '/app')) {
      await page.keyboard.press('Control+k');
      await expect(page.getByRole('combobox')).toBeFocused();
      await page.keyboard.type(s.label);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`${s.to}$`));
      await settle(page);
    }
  });

  test('sign in works with the keyboard alone', async ({ page, fakeApi }) => {
    fakeApi.db.session = false;
    await page.goto('/auth/login');
    await settle(page);
    await page.getByRole('textbox', { name: /email/i }).focus();
    await page.keyboard.type('mira@aster.example');
    await page.keyboard.press('Tab');
    await page.keyboard.type('demo-password-123');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  });

  test('dialogs trap focus and return it on Escape', async ({ page }) => {
    await page.goto('/app');
    await settle(page);
    const trigger = page.getByRole('button', { name: /^Notifications/ });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Notifications' });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 10; i += 1) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});
