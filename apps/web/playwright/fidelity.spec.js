import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { test, expect } from './fixtures.js';
import { FULL_DEMO, urlFor } from './sample-urls.js';
import { VIEWPORTS } from './viewports.js';

/**
 * Fidelity against the design prototype (plan G13-VR-003). Page bodies show different DEMO data than the prototype,
 * so the comparison covers the shared chrome only: navigation rail and top bar (bottom bar on mobile), with the
 * breadcrumb trail masked because it names the fake workspace. Each region must stay within 2% of the reference.
 * Diffs and a JSON report go to test-results/fidelity.
 */
const MAX_DRIFT = 0.02;
const OUT = 'test-results/fidelity';
const reference = (name) => PNG.sync.read(readFileSync(new URL(`./reference/${name}.png`, import.meta.url)));

/** Prototype view (reference/view-<name>-1440.png) → app route id or URL. */
const VIEWS = [
  ['home', 'home'],
  ['knowledge', 'knowledge'],
  ['doc', 'document'],
  ['writer', 'manuscript'],
  ['dna', 'dna'],
  ['library', 'library'],
  ['reader', 'reader'],
  ['discover', 'discover'],
  ['studio', 'studio-run'],
  ['costs', 'costs'],
  ['admin', 'admin-costs'],
  ['docs', 'docs'],
  ['settings', '/app/settings/models'],
];

const box = (r) => r && { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };

async function chrome(page) {
  return page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width && r.height ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
    };
    return { rail: rect('.rail'), topbar: rect('.topbar'), crumbs: rect('.crumbs') };
  });
}

function crop(png, { x, y, w, h }, masks) {
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(png, out, x, y, w, h, 0, 0);
  for (const m of masks) {
    for (let yy = Math.max(m.y - y, 0); yy < Math.min(m.y + m.h - y, h); yy += 1) {
      for (let xx = Math.max(m.x - x, 0); xx < Math.min(m.x + m.w - x, w); xx += 1) out.data.writeUInt32BE(0xff00ffff, (yy * w + xx) * 4);
    }
  }
  return out;
}

const report = [];

async function compare(page, name, refName) {
  const ref = reference(refName);
  const shot = PNG.sync.read(await page.screenshot());
  expect([shot.width, shot.height]).toEqual([ref.width, ref.height]);
  const g = await chrome(page);
  const masks = [box(g.crumbs)].filter(Boolean);
  const regions = Object.entries({ rail: box(g.rail), topbar: box(g.topbar) }).filter(([, r]) => r);
  expect(regions.length).toBeGreaterThan(0);
  mkdirSync(OUT, { recursive: true });
  const drifts = {};
  for (const [region, r] of regions) {
    const a = crop(shot, r, masks);
    const b = crop(ref, r, masks);
    const diff = new PNG({ width: r.w, height: r.h });
    const changed = pixelmatch(a.data, b.data, diff.data, r.w, r.h, { threshold: 0.1 });
    drifts[region] = Number((changed / (r.w * r.h)).toFixed(4));
    if (changed) writeFileSync(`${OUT}/${name}-${region}-diff.png`, PNG.sync.write(diff));
  }
  report.push({ view: name, reference: `${refName}.png`, ...drifts });
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  for (const [region, d] of Object.entries(drifts)) expect(d, `${name} ${region} drift`).toBeLessThanOrEqual(MAX_DRIFT);
}

test.describe('fidelity against the prototype', () => {
  test.use({ apiOptions: FULL_DEMO });

  for (const vp of VIEWPORTS) {
    test(`home chrome at ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/app');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await compare(page, `home-${vp.name}`, `home-${vp.name}`);
    });
  }

  for (const [view, target] of VIEWS) {
    test(`${view} view chrome`, async ({ page, fakeApi }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(target.startsWith('/') ? target : urlFor(target, fakeApi));
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
      await compare(page, `view-${view}`, `view-${view}-1440`);
    });
  }
});
