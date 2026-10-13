import { badgesFor, parseStatus, sortPages, toPage } from './catalog.js';

/**
 * Guide pages with their status badges, the parsed status file and screenshot URLs.
 * Throws when a page references a gate or external setup entry that the status file does not list.
 */
export async function loadDocs() {
  const { PAGE_SOURCES, STATUS_TEXT, IMAGES } = await import('./sources.js');
  const status = parseStatus(STATUS_TEXT);
  const pages = sortPages(Object.entries(PAGE_SOURCES).map(([path, text]) => toPage(path, text))).map((page) => ({
    ...page,
    badges: badgesFor(page, status),
  }));
  return { pages, status, images: IMAGES };
}

/** In-app URL of a guide page. */
export const docHref = (page) => `/app/docs/${page.slug}`;
