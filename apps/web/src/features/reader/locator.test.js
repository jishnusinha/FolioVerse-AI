import { describe, expect, it } from 'vitest';
import fixture from '../../../../../packages/contracts/fixtures/locator-cases.json';
import { locatorLabel, pageForLocator, percentOf } from './locator.js';

describe('pageForLocator golden fixtures', () => {
  for (const c of fixture.cases) {
    it(c.name, () => expect(pageForLocator(fixture.chapters, c.locator)).toBe(c.page));
  }
});

describe('locator labels', () => {
  it('names the chapter, a PDF page or nothing', () => {
    expect(locatorLabel(fixture.chapters, { href: 'Text/chapter-2.xhtml' })).toBe('Chapter 2 — The Archivist');
    expect(locatorLabel([], { type: 'application/pdf', locations: { page: 4 } })).toBe('p. 4');
    expect(locatorLabel(fixture.chapters, null)).toBe('');
  });

  it('clamps progression to a percentage', () => {
    expect(percentOf({ locations: { totalProgression: 0.456 } })).toBe(46);
    expect(percentOf({ locations: { totalProgression: 3 } })).toBe(100);
    expect(percentOf(null)).toBe(0);
  });
});
