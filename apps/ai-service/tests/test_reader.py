import re
from pathlib import Path
from types import SimpleNamespace

from helpers import ingest, of_type, run

from folioverse_ai.auth import Scope
from folioverse_ai.graphs.reader import gather_reader_context, passage_end
from folioverse_ai.ingestion.chunking import chunk_document
from folioverse_ai.ingestion.parsers import parse
from folioverse_ai.retrieval.retrieve import retrieve

WS = "0190f0f0-0000-7000-8000-0000000000a1"
EPUB = (Path(__file__).parents[3] / "datasets" / "synthetic" / "books" / "small-lanterns.epub").read_bytes()
SPOILER = "Rhea"
CH2_PASSAGE = (
    "He showed Ilse the oldest shelf, where the settlers' journals were kept in airtight sleeves, and "
    "explained that the ring passed perihelion every ninety-one days, when the light grew harsh enough to fade ink."
)
CH2_LATER = "Ilse copied one of his marginalia"


def test_epub_chapters_metadata_and_cfis():
    doc = parse(EPUB, "application/epub+zip")
    assert [c["title"] for c in doc.chapters] == [
        "Chapter 1 — The Halcyon Ring",
        "Chapter 2 — The Archivist",
        "Chapter 3 — A Lantern Fails",
        "Chapter 4 — Perihelion",
    ]
    assert [c["page"] for c in doc.chapters] == [1, 2, 3, 4]
    assert doc.chapters[0]["href"] == "chapter-1.xhtml"
    assert doc.metadata == {
        "title": "Orbit of Small Lanterns",
        "authors": ["Anaïs Verhoeven"],
        "language": "en",
        "publisher": "FolioVerse Synthetic Press (DEMO)",
        "publishedYear": 2024,
        "description": doc.metadata["description"],
        "subjects": ["Science fiction", "Family"],
        "isbn": "9780000000002",
    }
    heading, first_para = doc.elements[0], doc.elements[1]
    assert heading.kind == "heading" and heading.page == 1
    assert re.fullmatch(r"epubcfi\(/6/2\[[^\]]+\]!/4/2\)", heading.cfi), heading.cfi
    assert first_para.cfi.endswith("!/4/4)")
    ch2 = next(e for e in doc.elements if e.page == 2)
    assert ch2.cfi.startswith("epubcfi(/6/4[")
    assert ch2.heading_path == ["Chapter 2 — The Archivist"]


def test_book_chunks_never_span_chapters():
    doc = parse(EPUB, "application/epub+zip")
    chunks = chunk_document(doc, "0190f0f0-0000-7000-8000-00000000b00c")
    assert {c["page_start"] for c in chunks} == {1, 2, 3, 4}
    assert all(c["page_start"] == c["page_end"] for c in chunks)
    assert all(c["locator"]["cfi"].startswith("epubcfi(") for c in chunks)


def test_passage_end_is_whitespace_insensitive():
    text = "First line.\n\nHe showed Ilse\nthe oldest shelf. After."
    assert passage_end("He showed Ilse the oldest shelf.", text) == text.index(" After.")
    assert passage_end("Not in the chapter", text) is None


async def test_retrieval_page_limit_excludes_later_chapters(repo):
    svid = await ingest(EPUB, WS, "Orbit of Small Lanterns", "application/epub+zip")
    scope = Scope(run_id="r", workspace_id=WS, source_version_ids=(svid,))
    free = await retrieve("keeper of the lanterns Rhea Varga mother", scope)
    assert any(p["page"] == 4 for p in free.packed)
    capped = await retrieve("keeper of the lanterns Rhea Varga mother", scope, {"pageMax": 2})
    assert capped.packed and all(p["page"] <= 2 for p in capped.packed)
    assert all(SPOILER not in p["text"] for p in capped.packed)
    assert capped.params["pageMax"] == 2


async def test_reader_context_stops_at_the_passage(repo):
    svid = await ingest(EPUB, WS, "Orbit of Small Lanterns", "application/epub+zip")
    ctx = SimpleNamespace(
        scope=Scope(run_id="r", workspace_id=WS, source_version_ids=(svid,)),
        options={},
        workspace_id=WS,
        run_id="r",
    )
    packed, info = await gather_reader_context(ctx, CH2_PASSAGE, 2, CH2_PASSAGE)
    levels = [p["level"] for p in packed]
    assert levels.count("SUMMARY") == 1 and "CURRENT" in levels
    assert info == {"pageMax": 2, "current": 1, "earlier": levels.count("EARLIER"), "summaries": 1}
    text = "\n".join(p["text"] for p in packed)
    assert CH2_PASSAGE in text
    assert CH2_LATER not in text
    assert SPOILER not in text and "lullaby" not in text
    assert all(p["page"] <= 2 for p in packed)
    assert [p["marker"] for p in packed] == [f"S{i}" for i in range(1, len(packed) + 1)]


async def test_passage_explain_never_reveals_later_chapters(repo):
    svid = await ingest(EPUB, WS, "Orbit of Small Lanterns", "application/epub+zip")
    for mode, extra in (
        ("explain", {}),
        ("summarize", {}),
        ("define", {}),
        ("ask", {"question": "Who lights the lanterns?"}),
    ):
        term, events, _ = await run(
            "passage_explain",
            WS,
            [svid],
            {"params": {"page": 2, "mode": mode, "passage": CH2_PASSAGE, **extra}},
        )
        assert term["type"] == "run.finished", term
        answer = term["data"]["answer"]
        assert SPOILER not in answer and "mother" not in answer, (mode, answer)
        ret = of_type(events, "retrieval.completed")[0]["data"]
        assert ret["mode"] == "reader" and ret["spoilerGuard"]["pageMax"] == 2
        assert all(s["page"] <= 2 for s in ret["sources"])
        for c in of_type(events, "citation.validated"):
            assert c["data"]["state"] in ("VALID", "WEAK"), c
            assert c["data"]["anchor"]["selectors"]["page"] <= 2


async def test_passage_explain_in_first_chapter_uses_only_text_so_far(repo):
    svid = await ingest(EPUB, WS, "Orbit of Small Lanterns", "application/epub+zip")
    passage = "Every evening someone lit the small lanterns along the outer corridor."
    term, events, _ = await run(
        "passage_explain", WS, [svid], {"params": {"page": 1, "mode": "explain", "passage": passage}}
    )
    assert term["type"] == "run.finished"
    ret = of_type(events, "retrieval.completed")[0]["data"]
    assert ret["spoilerGuard"] == {"pageMax": 1, "current": 1, "earlier": 0, "summaries": 0}
    assert [s["level"] for s in ret["sources"]] == ["CURRENT"]
