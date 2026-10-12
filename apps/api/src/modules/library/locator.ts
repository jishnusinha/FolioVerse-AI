/**
 * Maps a reader Locator to the ingested page it falls on (an EPUB chapter is one page).
 * Mirrors apps/web/src/features/reader/locator.js; both run packages/contracts/fixtures/locator-cases.json.
 */
export interface Chapter {
  page: number;
  href: string;
  title?: string | null;
  idref?: string | null;
}

export interface Locator {
  href?: string;
  type?: string;
  title?: string;
  locations?: { progression?: number; totalProgression?: number; position?: number; cfi?: string; page?: number };
  text?: { before?: string; highlight?: string; after?: string };
}

const CFI_IDREF = /^epubcfi\(\/6\/\d+\[([^\]]+)\]/;

function normalize(href: string) {
  let h = href.split('#')[0].trim();
  try {
    h = decodeURIComponent(h);
  } catch {
    /* keep as is */
  }
  return h.replace(/^\.\//, '').replace(/^\/+/, '');
}

const posInt = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : null);

export function pageForLocator(chapters: Chapter[], loc: Locator | null | undefined): number | null {
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
      if (suffix) return suffix.page;
      return null;
    }
  }
  const idref = loc.locations?.cfi?.match(CFI_IDREF)?.[1];
  if (idref) return chapters.find((c) => c.idref === idref)?.page ?? null;
  const position = posInt(loc.locations?.position);
  if (position) return chapters.length ? (chapters[position - 1]?.page ?? null) : position;
  return chapters.length ? null : posInt(loc.locations?.page);
}
