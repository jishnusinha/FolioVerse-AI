"""Citation anchors on a multi-page PDF point at the page that contains the quote."""

from conftest import ROOT
from helpers import of_type, run

from folioverse_ai.events import Emitter
from folioverse_ai.ids import uuid7
from folioverse_ai.ingestion.pipeline import run_ingestion

WS = "0190f0f0-0000-7000-8000-0000000000c3"
PDF = ROOT / "datasets" / "synthetic" / "docs" / "atlas-brief.pdf"


async def ingest_pdf() -> str:
    svid = uuid7()
    res = await run_ingestion(
        {
            "jobId": uuid7(),
            "workspaceId": WS,
            "sourceId": uuid7(),
            "sourceVersionId": svid,
            "title": "atlas-brief.pdf",
            "mimeType": "application/pdf",
            "objectUrl": "unused",
        },
        Emitter(None, WS),
        data=PDF.read_bytes(),
    )
    assert res["state"] == "READY", res
    return svid


async def test_anchor_page_and_box_follow_the_quote(repo):
    svid = await ingest_pdf()
    term, events, _ = await run(
        "grounded_qa", WS, [svid], {"question": "How many organisations did the survey cover?"}
    )
    assert term["data"]["outcome"] == "ANSWERED", term
    cites = [c["data"] for c in of_type(events, "citation.validated")]
    survey = next(c for c in cites if "412" in c["quote"])
    sel = survey["anchor"]["selectors"]
    assert sel["page"] == 3
    assert survey["anchor"]["state"] == "EXACT"
    page_text = await repo.page_text(svid, 3)
    assert page_text[sel["textPosition"]["start"] : sel["textPosition"]["end"]] == survey["quote"]
    assert len(sel["bbox"]) == 4
