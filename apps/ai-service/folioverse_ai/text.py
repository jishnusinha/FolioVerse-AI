"""Deterministic text utilities shared by chunking, retrieval, citation validation and mocks."""

import re

STOPWORDS = frozenset(
    """a an and are as at be been but by can could did do does for from had has have he her his i if in into is it its
    of on or our she so than that the their them then there these they this to was we were what when where which who
    why will with would you your not no yes also about after all any because before being both each few more most other
    some such only own same too very just over under again further once here how out up down off above below between
    through during while until against among per via vs""".split()
)

_TOKEN = re.compile(r"[a-z0-9]+(?:\.[0-9]+)?", re.I)
_SENT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(\[])")
_COUNT = re.compile(r"\w+|[^\w\s]", re.UNICODE)
_BLOCK = re.compile(r"\n\s*\n|\n(?=\s*(?:#{1,6}\s|[-*•]\s|\d+[.)]\s))")
_BULLET = re.compile(r"^(?:#{1,6}|[-*•]|\d+[.)])\s+")


def count_tokens(text: str) -> int:
    """Approximate token count (words and punctuation). Offline and deterministic."""
    return len(_COUNT.findall(text or ""))


def tokens(text: str) -> list[str]:
    return [t.lower() for t in _TOKEN.findall(text or "")]


def content_words(text: str) -> list[str]:
    return [t for t in tokens(text) if t not in STOPWORDS and (len(t) > 1 or t.isdigit())]


def split_sentences(text: str) -> list[str]:
    """Sentences, also breaking at blank lines, headings and list items (a heading is never merged
    into the following sentence)."""
    out: list[str] = []
    for block in _BLOCK.split((text or "").strip()):
        block = _BULLET.sub("", block.strip())
        out.extend(p.strip() for p in _SENT.split(block) if p.strip())
    return out


def containment(claim: str, source: str) -> float:
    """Share of the claim's distinct content words that appear in the source."""
    cw = set(content_words(claim))
    if not cw:
        return 0.0
    sw = set(content_words(source))
    return len(cw & sw) / len(cw)


def best_sentence(query: str, text: str) -> tuple[str, float]:
    best, score = "", -1.0
    for s in split_sentences(text):
        sc = containment(query, s) + 0.01 * min(len(content_words(s)), 30) / 30
        if sc > score:
            best, score = s, sc
    return best, max(score, 0.0)


def similarity(a: str, b: str) -> float:
    """Character-level similarity ratio in [0, 1] (difflib-free, bigram Dice)."""
    if a == b:
        return 1.0
    if len(a) < 2 or len(b) < 2:
        return 0.0
    ba = [a[i : i + 2] for i in range(len(a) - 1)]
    bb = [b[i : i + 2] for i in range(len(b) - 1)]
    counts: dict[str, int] = {}
    for g in bb:
        counts[g] = counts.get(g, 0) + 1
    overlap = 0
    for g in ba:
        if counts.get(g, 0) > 0:
            overlap += 1
            counts[g] -= 1
    return 2 * overlap / (len(ba) + len(bb))
