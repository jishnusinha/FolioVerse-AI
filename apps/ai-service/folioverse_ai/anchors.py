"""Anchor building and re-anchoring (contracts: fixtures/anchor-cases.json)."""

from .text import similarity

FUZZY_THRESHOLD = 0.8
CONTEXT_CHARS = 32


def reanchor(old_text: str, new_text: str, anchor: dict) -> dict:
    """Resolves a textQuote/textPosition selector against a new text.

    EXACT when the quote sits at the same offsets, SHIFTED when it is found elsewhere (nearest to
    the old start wins), FUZZY when a same-length window is at least 80% similar, else ORPHANED.
    """
    quote = anchor["textQuote"]["exact"]
    pos = anchor.get("textPosition") or {}
    start = pos.get("start", 0)
    end = pos.get("end", start + len(quote))
    if new_text[start:end] == quote:
        return {"state": "EXACT", "start": start, "end": end}
    hits = []
    i = new_text.find(quote)
    while i >= 0:
        hits.append(i)
        i = new_text.find(quote, i + 1)
    if hits:
        best = min(hits, key=lambda h: abs(h - start))
        return {"state": "SHIFTED", "start": best, "end": best + len(quote)}
    n = len(quote)
    best_score, best_at = 0.0, -1
    if n and len(new_text) >= max(1, n - 4):
        for width in (n - 1, n, n + 1, n + 2):
            if width <= 0 or width > len(new_text):
                continue
            for j in range(0, len(new_text) - width + 1):
                sc = similarity(quote, new_text[j : j + width])
                if sc > best_score:
                    best_score, best_at = sc, j
                    best_w = width
    if best_score >= FUZZY_THRESHOLD and best_at >= 0:
        return {"state": "FUZZY", "start": best_at, "end": best_at + best_w, "score": round(best_score, 4)}
    return {"state": "ORPHANED"}


def build_anchor(source_version_id: str, chunk: dict, quote: str, page_text: str | None) -> dict:
    """Builds a SourceAnchor for a quote inside a chunk, resolving page-relative offsets when possible."""
    loc = chunk.get("locator") or {}
    page = chunk.get("page_start") or loc.get("page")
    selectors: dict = {}
    if page:
        selectors["page"] = int(page)
    if loc.get("headingPath"):
        selectors["headingPath"] = loc["headingPath"]
    if loc.get("href"):
        selectors["cfi"] = loc["href"]
    state = "FUZZY"
    if quote:
        q = {"exact": quote}
        if page_text:
            at = page_text.find(quote)
            if at >= 0:
                q["prefix"] = page_text[max(0, at - CONTEXT_CHARS) : at]
                q["suffix"] = page_text[at + len(quote) : at + len(quote) + CONTEXT_CHARS]
                selectors["textPosition"] = {"start": at, "end": at + len(quote)}
                state = "EXACT"
                for box in loc.get("boxes", []):
                    if box.get("page") == page and box.get("start", 0) <= at < box.get("end", 0):
                        selectors["bbox"] = box["bbox"]
                        break
        selectors["textQuote"] = q
    if "bbox" not in selectors and loc.get("bbox") and loc.get("page") == page:
        selectors["bbox"] = loc["bbox"]
    return {
        "sourceVersionId": source_version_id,
        "chunkId": chunk.get("id"),
        "selectors": selectors,
        "state": state,
    }
