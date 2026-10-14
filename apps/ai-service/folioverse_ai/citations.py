"""Deterministic citation validation (contracts: fixtures/citation-cases.json).

Each [S#] marker is checked against the packed context that was sent to the model. Unknown
markers are UNRESOLVED; otherwise the claim segment preceding the marker is scored by content-word
containment in the cited text: >= VALID_THRESHOLD is VALID, else WEAK. Repeated markers keep the
best score. No model is involved, so validation is free and reproducible.
"""

import re
from dataclasses import dataclass, field

from .text import best_sentence, containment, split_sentences

VALID_THRESHOLD = 0.45
MARKER = re.compile(r"\[(S\d+)\]")


@dataclass
class CitationResult:
    marker: str
    state: str
    score: float
    quote: str = ""
    claim: str = ""
    item: dict | None = field(default=None, repr=False)


def claim_segments(answer: str) -> list[tuple[str, str]]:
    """Returns (marker, claim_text) pairs. The claim is the text since the previous marker or sentence start."""
    out: list[tuple[str, str]] = []
    for sentence in split_sentences(answer) or [answer]:
        last = 0
        for m in MARKER.finditer(sentence):
            seg = sentence[last : m.start()]
            seg = MARKER.sub("", seg).strip(" ,;:-")
            if not seg.strip():
                seg = MARKER.sub("", sentence)
            out.append((m.group(1), seg))
            last = m.end()
    return out


def validate(answer: str, context: dict[str, dict]) -> dict[str, CitationResult]:
    """`context` maps marker -> packed item with at least a `text` key."""
    results: dict[str, CitationResult] = {}
    for marker, claim in claim_segments(answer):
        item = context.get(marker)
        if item is None:
            if marker not in results:
                results[marker] = CitationResult(marker, "UNRESOLVED", 0.0, claim=claim)
            continue
        score = containment(claim, item["text"])
        state = "VALID" if score >= VALID_THRESHOLD else "WEAK"
        prev = results.get(marker)
        if prev is None or score > prev.score:
            quote, _ = best_sentence(claim, item["text"])
            results[marker] = CitationResult(
                marker, state, round(score, 4), quote=quote or item["text"][:200], claim=claim, item=item
            )
    return results


@dataclass
class CitationOccurrence:
    index: int
    marker: str
    state: str
    score: float
    quote: str = ""
    claim: str = ""
    item: dict | None = field(default=None, repr=False)


def validate_occurrences(answer: str, context: dict[str, dict]) -> list[CitationOccurrence]:
    """Validates each cited claim occurrence individually.
    Never allows a valid first occurrence to mask invalid subsequent occurrences of the same marker."""
    results: list[CitationOccurrence] = []
    for idx, (marker, claim) in enumerate(claim_segments(answer)):
        item = context.get(marker)
        if item is None:
            results.append(CitationOccurrence(idx, marker, "UNRESOLVED", 0.0, claim=claim))
            continue
        score = containment(claim, item["text"])
        state = "VALID" if score >= VALID_THRESHOLD else "WEAK"
        quote, _ = best_sentence(claim, item["text"])
        results.append(
            CitationOccurrence(
                idx,
                marker,
                state,
                round(score, 4),
                quote=quote or item["text"][:200],
                claim=claim,
                item=item,
            )
        )
    return results


def strip_markers(text: str) -> str:
    return MARKER.sub("", text)


def answer_sentences_with_markers(answer: str) -> list[str]:
    return [s for s in split_sentences(answer) if MARKER.search(s)]


# Conversational / non-factual sentence patterns that do not need citation
_NON_FACTUAL = re.compile(
    r"^(yes|no|i (cannot|can't|don't|do not|am unable|apologize)|sorry|thank|based on|according to|as mentioned|in summary|in conclusion|to summarize|the (sources|documents|provided|above|following)|note that|please|feel free|let me|here (is|are)|there (is|are) no|i (found|see|notice))",
    re.IGNORECASE,
)
_HEADING_LIKE = re.compile(r"^(#+\s|[A-Z][A-Z\s]{2,}:)")


def is_factual_claim(sentence: str) -> bool:
    """Heuristic: a sentence is a factual claim if it is not conversational boilerplate or a heading."""
    s = sentence.strip()
    if len(s) < 12:
        return False
    if _HEADING_LIKE.match(s):
        return False
    if _NON_FACTUAL.match(s):
        return False
    # Must have at least one content-word (rough check: >= 3 alpha chars in a row)
    if not re.search(r"[a-zA-Z]{3}", s):
        return False
    return True


def find_uncited_factual_sentences(answer: str) -> list[str]:
    """Returns sentences that look like factual claims but carry no citation marker."""
    out = []
    for sentence in split_sentences(answer) or [answer]:
        if MARKER.search(sentence):
            continue  # has at least one citation
        clean = MARKER.sub("", sentence).strip()
        if is_factual_claim(clean):
            out.append(clean)
    return out


def has_uncited_factual_claims(answer: str) -> bool:
    """True when the answer contains at least one factual claim sentence without a citation marker."""
    return bool(find_uncited_factual_sentences(answer))
