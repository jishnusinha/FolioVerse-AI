/**
 * Unified reader Locator (Readium-style) shared by the EPUB and PDF engines:
 * `{ href, type, title, locations: { progression, totalProgression, position, cfi, page }, text: { before, highlight, after } }`.
 *
 * `pageForLocator` mirrors apps/api/src/modules/library/locator.ts; both run
 * packages/contracts/fixtures/locator-cases.json. An EPUB chapter is one ingested page.
 */

const CFI_IDREF = /^epubcfi\(\/6\/\d+\[([^\]]+)\]/;

function normalize(href) {
  let h = String(href).split('#')[0].trim();
  try {
    h = decodeURIComponent(h);
  } catch {
    /* keep as is */
  }
  return h.replace(/^\.\//, '').replace(/^\/+/, '');
}

const posInt = (n) => (typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : null);

/**
 * @param {{ page: number, href: string, idref?: string | null }[]} chapters
 * @param {any} loc
 * @returns {number | null}
 */
export function pageForLocator(chapters, loc) {
  if (!loc) return null;
  if (loc.type === 'application/pdf') return posInt(loc.locations?.page);
  if (loc.href) {
    const h = normalize(loc.href);
    if (h) {
      const exact = chapters.find((c) => normalize(c.href) === h);
      if (exact) return exact.page;
      const suffix = chapters.find((c) => {
        const ch = normalize(c.href);
        return h.endsWith(`/${ch}`) || ch.endsWith(`/${h}`);
      });
      return suffix ? suffix.page : null;
    }
  }
  const idref = loc.locations?.cfi?.match(CFI_IDREF)?.[1];
  if (idref) return chapters.find((c) => c.idref === idref)?.page ?? null;
  const position = posInt(loc.locations?.position);
  if (position) return chapters.length ? (chapters[position - 1]?.page ?? null) : position;
  return chapters.length ? null : posInt(loc.locations?.page);
}

/** The chapter a locator falls in, or null. */
export function chapterFor(chapters, loc) {
  const page = pageForLocator(chapters, loc);
  return page ? (chapters.find((c) => c.page === page) ?? null) : null;
}

/** Short human label for a position: chapter title or page number. */
export function locatorLabel(chapters, loc) {
  if (!loc) return '';
  if (loc.type === 'application/pdf') return loc.locations?.page ? `p. ${loc.locations.page}` : '';
  const ch = chapterFor(chapters, loc);
  return ch?.title || loc.title || (ch ? `Chapter ${ch.page}` : '');
}

/** Reading percentage (0–100) from a locator's total progression. */
export const percentOf = (loc) => Math.round(Math.min(1, Math.max(0, loc?.locations?.totalProgression ?? 0)) * 100);
