"""Parent/child chunking with locators.

Parents (~1200 tokens) give the model coherent context; children (~300 tokens, 15% overlap) are
what gets embedded and retrieved. Chunk ids are deterministic so re-ingesting a version
overwrites its vectors instead of duplicating them.
"""

from ..ids import stable_id
from ..text import count_tokens
from .parsers import Element, ParsedDocument

PARENT_TOKENS = 1200
CHILD_TOKENS = 300
CHILD_OVERLAP = 0.15


def _locator(els: list[Element]) -> dict:
    first = els[0]
    boxes = [{"page": e.page, "bbox": e.bbox, "start": e.start, "end": e.end} for e in els if e.bbox]
    loc: dict = {
        "page": first.page,
        "start": first.start,
        "end": els[-1].end if els[-1].page == first.page else None,
        "boxes": boxes,
    }
    if first.bbox:
        loc["bbox"] = first.bbox
    if first.heading_path:
        loc["headingPath"] = first.heading_path
    if first.href:
        loc["href"] = first.href
    return loc


def _split_long(el: Element, max_tokens: int) -> list[Element]:
    if count_tokens(el.text) <= max_tokens:
        return [el]
    words = el.text.split(" ")
    out, cur, offset = [], [], el.start
    for w in words:
        cur.append(w)
        if count_tokens(" ".join(cur)) >= max_tokens:
            t = " ".join(cur)
            out.append(
                Element(el.page, t, offset, offset + len(t), el.kind, el.bbox, el.heading_path, el.href)
            )
            offset += len(t) + 1
            cur = []
    if cur:
        t = " ".join(cur)
        out.append(Element(el.page, t, offset, offset + len(t), el.kind, el.bbox, el.heading_path, el.href))
    return out


def _group(els: list[Element], budget: int) -> list[list[Element]]:
    groups: list[list[Element]] = []
    cur: list[Element] = []
    n = 0
    for e in els:
        t = count_tokens(e.text)
        if cur and n + t > budget:
            groups.append(cur)
            cur, n = [], 0
        cur.append(e)
        n += t
    if cur:
        groups.append(cur)
    return groups


def chunk_document(doc: ParsedDocument, source_version_id: str) -> list[dict]:
    elements = [p for e in doc.elements for p in _split_long(e, CHILD_TOKENS)]
    chunks: list[dict] = []
    child_ord = 0
    for p_ord, parent_els in enumerate(_group(elements, PARENT_TOKENS)):
        pid = stable_id(source_version_id, "PARENT", p_ord)
        ptext = "\n\n".join(e.text for e in parent_els)
        chunks.append(
            {
                "id": pid,
                "parent_id": None,
                "level": "PARENT",
                "ordinal": p_ord,
                "text": ptext,
                "token_count": count_tokens(ptext),
                "page_start": parent_els[0].page,
                "page_end": parent_els[-1].page,
                "locator": _locator(parent_els),
                "heading_path": parent_els[0].heading_path,
            }
        )
        groups = _group(parent_els, CHILD_TOKENS)
        for gi, child_els in enumerate(groups):
            # Overlap: prepend the tail element(s) of the previous child group (~15%).
            overlap: list[Element] = []
            if gi > 0:
                prev = groups[gi - 1]
                budget = int(CHILD_TOKENS * CHILD_OVERLAP)
                for e in reversed(prev):
                    if count_tokens(e.text) > budget:
                        break
                    overlap.insert(0, e)
                    budget -= count_tokens(e.text)
            els = overlap + child_els
            ctext = "\n\n".join(e.text for e in els)
            chunks.append(
                {
                    "id": stable_id(source_version_id, "CHILD", child_ord),
                    "parent_id": pid,
                    "level": "CHILD",
                    "ordinal": child_ord,
                    "text": ctext,
                    "token_count": count_tokens(ctext),
                    "page_start": els[0].page,
                    "page_end": els[-1].page,
                    "locator": _locator(child_els),
                    "heading_path": child_els[0].heading_path,
                }
            )
            child_ord += 1
    return chunks
