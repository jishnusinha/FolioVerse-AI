import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanLocator } from '../../src/modules/library/library.controller';
import { pageForLocator } from '../../src/modules/library/locator';
import { fromGoogleBooks, fromOpenLibrary } from '../../src/modules/library/metadata.service';

const fixture = JSON.parse(readFileSync(join(__dirname, '../../../../packages/contracts/fixtures/locator-cases.json'), 'utf8'));

describe('pageForLocator golden fixtures', () => {
  for (const c of fixture.cases) {
    it(c.name, () => expect(pageForLocator(fixture.chapters, c.locator)).toBe(c.page));
  }

  it('uses the position as the page when the book has no chapters', () => {
    expect(pageForLocator([], { locations: { position: 3 } })).toBe(3);
    expect(pageForLocator([], { locations: { page: 5 } })).toBe(5);
  });
});

describe('cleanLocator', () => {
  it('keeps known fields, clamps numbers and drops the rest', () => {
    const l = cleanLocator({
      href: 'Text/chapter-2.xhtml',
      evil: '<script>',
      locations: { progression: 1.7, position: 2.5, cfi: 'epubcfi(/6/4!/4/2)', extra: 1 },
      text: { highlight: 'x'.repeat(5000) },
    });
    expect(l).toEqual({
      href: 'Text/chapter-2.xhtml',
      locations: { progression: 1, cfi: 'epubcfi(/6/4!/4/2)' },
      text: { highlight: 'x'.repeat(4000) },
    });
  });

  it('returns an empty locator for junk', () => {
    expect(cleanLocator({ href: 42, locations: 'x' } as any)).toEqual({});
  });
});

describe('metadata normalisation', () => {
  it('maps an Open Library search doc', () => {
    const r = fromOpenLibrary({ key: '/works/OL1W', title: 'Salt Year', author_name: ['Hedda Lund'], first_publish_year: 2019, isbn: ['0123456789', '9780000000019'], cover_i: 42, subject: ['Sea'] });
    expect(r).toMatchObject({ provider: 'OPEN_LIBRARY', title: 'Salt Year', authors: ['Hedda Lund'], publishedYear: 2019, isbn13: '9780000000019', subjects: ['Sea'] });
    expect(r.coverUrl).toBe('https://covers.openlibrary.org/b/id/42-M.jpg');
    expect(r.externalIds).toEqual({ openLibrary: '/works/OL1W' });
  });

  it('maps a Google Books volume and forces https covers', () => {
    const r = fromGoogleBooks({
      id: 'abc',
      volumeInfo: {
        title: 'Salt Year',
        authors: ['Hedda Lund'],
        publishedDate: '2019-04-02',
        industryIdentifiers: [{ type: 'ISBN_10', identifier: '0123456789' }, { type: 'ISBN_13', identifier: '9780000000019' }],
        imageLinks: { thumbnail: 'http://books.google.com/x.jpg' },
        description: '<p>Tides.</p>',
      },
    });
    expect(r).toMatchObject({ provider: 'GOOGLE_BOOKS', publishedYear: 2019, isbn13: '9780000000019', coverUrl: 'https://books.google.com/x.jpg' });
    expect(r.description?.trim()).toBe('Tides.');
  });
});
