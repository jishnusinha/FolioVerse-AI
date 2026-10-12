/**
 * Evidence drawer payload for one citation marker.
 * @param {string} marker
 * @param {Record<string, any>} citations keyed by marker (`citation.validated` data or message citations)
 * @param {{ titleOf: (svid?: string) => string, versionNoOf: (svid?: string) => number | undefined, currentVersionNoOf: (svid?: string) => number | undefined }} lookup
 */
export function evidenceFor(marker, citations, lookup) {
  const c = citations[marker];
  const anchor = c?.anchor ?? null;
  const svid = anchor?.sourceVersionId ?? c?.sourceVersionId;
  const page = anchor?.selectors?.page;
  return {
    marker,
    state: c?.state ?? 'UNRESOLVED',
    anchorState: anchor?.state,
    title: lookup.titleOf(svid),
    versionNumber: lookup.versionNoOf(svid),
    currentVersionNumber: lookup.currentVersionNoOf(svid),
    locator: page ? `Page ${page}` : undefined,
    quote: c?.quote || null,
    anchor,
  };
}

/** @param {any[]} list `citation.validated` payloads */
export const byMarker = (list) => Object.fromEntries((list ?? []).map((c) => [c.marker, c]));
