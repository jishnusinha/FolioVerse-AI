"""Deterministic extractive helpers. They draft the mock provider's output (so demo answers are
grounded and their citations validate) and provide fallbacks when a live model's JSON is malformed."""

import re
from collections import Counter

from ..text import containment, content_words, split_sentences

RISK_TERMS = (
    "risk",
    "risks",
    "uncertain",
    "uncertainty",
    "decline",
    "declines",
    "threat",
    "threats",
    "exposure",
    "volatility",
    "delay",
    "delays",
    "shortage",
    "dependency",
    "depends",
    "could",
    "may",
    "might",
    "concern",
    "concerns",
    "downside",
    "breach",
    "penalty",
    "liability",
    "fail",
    "failure",
    "loss",
    "losses",
)


def _clean(sentence: str) -> str:
    return re.sub(r"\s+", " ", sentence).strip().rstrip(".!?;:")


def sentences_of(packed: list[dict]) -> list[tuple[str, str]]:
    out = []
    for p in packed:
        for s in split_sentences(p["text"]):
            if 4 <= len(content_words(s)) <= 60:
                out.append((p["marker"], _clean(s)))
    return out


def key_sentences(packed: list[dict], n: int = 5, query: str | None = None) -> list[tuple[str, str]]:
    sents = sentences_of(packed)
    if not sents:
        return []
    freq = Counter(w for _, s in sents for w in content_words(s))
    scored = []
    for i, (m, s) in enumerate(sents):
        words = content_words(s)
        centrality = sum(freq[w] for w in set(words)) / (len(set(words)) or 1)
        relevance = containment(query, s) * 10 if query else 0
        number_bonus = 0.5 if re.search(r"\d", s) else 0
        scored.append((relevance + centrality + number_bonus, i, m, s))
    top = sorted(scored, reverse=True)[:n]
    seen, out = set(), []
    for _, _i, m, s in sorted(top, key=lambda t: t[1]):
        if s.lower() not in seen:
            seen.add(s.lower())
            out.append((m, s))
    return out


def cite(sentences: list[tuple[str, str]], bullet: bool = False) -> str:
    lines = [f"{s} [{m}]." for m, s in sentences]
    return "\n".join(f"- {line}" for line in lines) if bullet else " ".join(lines)


def answer_for(question: str, packed: list[dict], n: int = 3) -> str:
    picks = []
    for p in packed:
        best, score = "", 0.0
        for s in split_sentences(p["text"]):
            sc = containment(question, s)
            if sc > score and len(content_words(s)) >= 4:
                best, score = _clean(s), sc
        if best and score > 0:
            picks.append((score, p["marker"], best))
    picks.sort(key=lambda t: -t[0])
    chosen, seen = [], set()
    for _, m, s in picks:
        if s.lower() in seen:
            continue
        seen.add(s.lower())
        chosen.append((m, s))
        if len(chosen) >= n:
            break
    if not chosen:
        chosen = key_sentences(packed, 2, question)
    return cite(chosen)


def risk_sentences(packed: list[dict], n: int = 6) -> list[tuple[str, str]]:
    out = []
    for m, s in sentences_of(packed):
        words = set(content_words(s)) | set(re.findall(r"[a-z]+", s.lower()))
        if words & set(RISK_TERMS):
            out.append((m, s))
    return out[:n]


_NUM = re.compile(r"(\d+(?:\.\d+)?)\s*(%|percent|million|billion|days|years|months)?", re.I)


def contradictions(packed: list[dict], n: int = 4) -> list[dict]:
    """Pairs of sentences from different sources that share subject words but state different numbers."""
    sents = [
        (m, s, set(content_words(s)), {(v, (u or "").lower()) for v, u in _NUM.findall(s)})
        for m, s in sentences_of(packed)
    ]
    out = []
    for i, (m1, s1, w1, n1) in enumerate(sents):
        if not n1:
            continue
        for m2, s2, w2, n2 in sents[i + 1 :]:
            if m1 == m2 or not n2:
                continue
            shared = {w for w in w1 & w2 if not w.replace(".", "").isdigit()}
            units1 = {u for _, u in n1 if u}
            units2 = {u for _, u in n2 if u}
            if len(shared) >= 3 and units1 & units2 and n1.isdisjoint(n2):
                out.append(
                    {
                        "a": {"marker": m1, "text": s1},
                        "b": {"marker": m2, "text": s2},
                        "shared": sorted(shared)[:6],
                    }
                )
                if len(out) >= n:
                    return out
    return out


_ENTITY = re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b")
_STOP_ENT = {
    "The",
    "This",
    "That",
    "These",
    "Those",
    "In",
    "On",
    "At",
    "For",
    "And",
    "But",
    "If",
    "When",
    "While",
    "It",
    "A",
    "An",
    "As",
    "By",
    "With",
    "From",
    "Our",
    "We",
    "He",
    "She",
    "They",
    "Chapter",
    "Section",
    "Page",
}


def entities(text: str, min_count: int = 2, limit: int = 18) -> list[tuple[str, int]]:
    counts: Counter = Counter()
    for s in split_sentences(text):
        for m in _ENTITY.finditer(s):
            words = m.group(1).split()
            while words and words[0] in _STOP_ENT:
                words.pop(0)
            if words:
                counts[" ".join(words)] += 1
    return [(e, c) for e, c in counts.most_common(limit * 2) if c >= min_count][:limit]


def cooccurrence(text: str, ents: list[str]) -> list[tuple[str, str, int]]:
    pairs: Counter = Counter()
    for s in split_sentences(text):
        present = [e for e in ents if e in s]
        for i, a in enumerate(present):
            for b in present[i + 1 :]:
                pairs[tuple(sorted((a, b)))] += 1
    return [(a, b, c) for (a, b), c in pairs.most_common(40)]


def difficult_words(text: str, n: int = 4) -> list[str]:
    words = sorted({w for w in re.findall(r"[A-Za-z]{9,}", text)}, key=lambda w: (-len(w), w))
    return words[:n]
