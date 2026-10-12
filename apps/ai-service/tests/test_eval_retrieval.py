"""Retrieval quality on ``datasets/evaluation/qa-small.jsonl`` (logged, not gating).

Uses the hermetic test stack (hash embedder + BM25). Recall below the floor warns instead of failing;
run with ``-s`` to see the metrics line.
"""

import json
import warnings

from conftest import ROOT

from folioverse_ai.auth import Scope
from folioverse_ai.events import Emitter
from folioverse_ai.ids import uuid7
from folioverse_ai.ingestion.pipeline import run_ingestion
from folioverse_ai.retrieval.retrieve import retrieve

DATA = ROOT / "datasets"
WS = "0190f0f0-0000-7000-8000-0000000000e1"
TOP_K = 5
RECALL_FLOOR = 0.8


async def test_qa_small_recall_at_k(repo):
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
        data=(DATA / "synthetic" / "docs" / "atlas-brief.pdf").read_bytes(),
    )
    assert res["state"] == "READY", res
    scope = Scope(run_id="eval", workspace_id=WS, source_version_ids=(svid,))

    lines = (DATA / "evaluation" / "qa-small.jsonl").read_text(encoding="utf-8").splitlines()
    cases = [json.loads(line) for line in lines if line.strip()]
    hits = page_hits = answerable = abstained = unanswerable = 0
    misses = []
    for case in cases:
        r = await retrieve(case["question"], scope, {"topK": TOP_K})
        if not case["answerable"]:
            unanswerable += 1
            abstained += int(r.abstain)
            continue
        answerable += 1
        packed = r.packed[:TOP_K]
        hit = any(case["evidence"].lower() in (p["childText"] + " " + p["text"]).lower() for p in packed)
        hits += int(hit)
        page_hits += int(any(p["page"] == case["page"] for p in packed))
        if not hit:
            misses.append(case["id"])

    metrics = {
        "dataset": "qa-small",
        "embedder": r.params["embedder"],
        "k": TOP_K,
        "recall_at_k": round(hits / answerable, 3),
        "page_recall_at_k": round(page_hits / answerable, 3),
        "abstain_accuracy": round(abstained / unanswerable, 3),
        "misses": misses,
    }
    print("retrieval-eval", json.dumps(metrics))
    if metrics["recall_at_k"] < RECALL_FLOOR:
        warnings.warn(f"recall@{TOP_K} {metrics['recall_at_k']} below {RECALL_FLOOR}", stacklevel=1)
    assert answerable == 10 and unanswerable == 2
