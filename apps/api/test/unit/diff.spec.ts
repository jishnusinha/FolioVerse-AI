import { diffParagraphs, paragraphs } from '../../src/modules/sources/diff';
import { prefixQuery } from '../../src/modules/search/search.controller';

const v1 = paragraphs([
  { pageNo: 1, text: 'Market Outlook 2026\n\nThe base case projects 14.2% annual growth through 2030.\n\nRegulated industries lead demand.' },
  { pageNo: 2, text: 'Bundled office suites are the main pricing risk.' },
]);
const v2 = paragraphs([
  { pageNo: 1, text: 'Market Outlook 2026\n\nThe base case projects 12.5% annual growth through 2030.\n\nRegulated industries lead demand.' },
  { pageNo: 2, text: 'A new appendix lists the survey questions.' },
]);

describe('version diff', () => {
  it('splits pages into paragraphs with page and index', () => {
    expect(v1.map((p) => [p.page, p.index])).toEqual([
      [1, 0],
      [1, 1],
      [1, 2],
      [2, 0],
    ]);
  });

  it('counts unchanged, changed, added and removed paragraphs', () => {
    const d = diffParagraphs(v1, v2);
    expect(d).toMatchObject({ unchanged: 2, changed: 1, added: 1, removed: 1 });
    expect(d.samples.changed[0].before.text).toContain('14.2%');
    expect(d.samples.changed[0].after.text).toContain('12.5%');
    expect(d.samples.added[0].text).toContain('appendix');
    expect(d.samples.removed[0].text).toContain('pricing risk');
  });

  it('reports no changes for identical versions', () => {
    expect(diffParagraphs(v1, v1)).toMatchObject({ unchanged: 4, changed: 0, added: 0, removed: 0 });
  });
});

describe('search prefix query', () => {
  it('keeps only words and adds prefix matching', () => {
    expect(prefixQuery("grow & !risk') | x")).toBe('grow:* & risk:* & x:*');
    expect(prefixQuery('  &|!  ')).toBeNull();
  });
});
