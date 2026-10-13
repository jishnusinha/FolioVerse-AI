"""Gate 8 Studio: X-Ray packer decisions, chunk level, frozen context (Model Battle), concise mock, judge."""

import json

from conftest import MOCK_PLAN
from corpus import MARKET, OTHER_TENANT_DOC
from helpers import ingest, of_type, run

from folioverse_ai.providers import concise

WS_A = "0190f0f0-0000-7000-8000-0000000000a1"
WS_B = "0190f0f0-0000-7000-8000-0000000000b2"
QUESTION = "What annual growth does the base case project through 2030?"


async def test_xray_candidates_carry_ranks_and_packer_decisions(repo):
    svid = await ingest(MARKET, WS_A, "Market Outlook")
    await run("grounded_qa", WS_A, [svid], {"question": QUESTION}, options={"topK": 2})
    ev = repo.retrieval_events[-1]
    cands = ev["candidates"]
    assert [c["finalRank"] for c in cands] == list(range(1, len(cands) + 1))
    assert all(c["fusedRank"] for c in cands)
    notes = {c["note"] for c in cands}
    assert notes <= {
        "packed-parent",
        "packed-child",
        "parent-already-packed",
        "over-budget",
        "below-top-k",
        "missing-text",
    }
    assert sum(c["packed"] for c in cands) == len(ev["packed"])
    assert all(c["note"] == "below-top-k" for c in cands[2:])
    assert ev["params"]["mode"] == "query" and ev["params"]["chunkLevel"] == "auto"
    for p in ev["packed"]:
        assert p["pageFrom"] <= p["page"] <= p["pageTo"]


async def test_child_chunk_level_never_packs_parents(repo):
    svid = await ingest(MARKET, WS_A, "Market Outlook")
    term, _, _ = await run(
        "grounded_qa", WS_A, [svid], {"question": QUESTION}, options={"chunkLevel": "child"}
    )
    ev = repo.retrieval_events[-1]
    assert ev["params"]["chunkLevel"] == "child"
    assert ev["packed"] and all(p["level"] == "CHILD" for p in ev["packed"])
    assert term["data"]["outcome"] == "ANSWERED"


async def test_frozen_context_reuses_recorded_passages_and_enforces_scope(repo):
    svid = await ingest(MARKET, WS_A, "Market Outlook")
    secret = await ingest(OTHER_TENANT_DOC, WS_B, "Merger memo")
    await run("grounded_qa", WS_A, [svid], {"question": QUESTION})
    recorded = repo.retrieval_events[-1]["packed"]
    foreign = next(c for c in repo.chunks.values() if c["source_version_id"] == secret)
    frozen = [{"chunkId": p["chunkId"], "level": p["level"]} for p in recorded] + [
        {"chunkId": foreign["id"], "level": "CHILD"}
    ]

    term, events, _ = await run(
        "grounded_qa",
        WS_A,
        [svid, secret],
        {"question": QUESTION},
        options={"frozenContext": frozen, "frozenFrom": "parent-run"},
    )
    ev = repo.retrieval_events[-1]
    assert ev["params"]["mode"] == "frozen" and ev["params"]["frozenFrom"] == "parent-run"
    assert [p["chunkId"] for p in ev["packed"]] == [p["chunkId"] for p in recorded]
    assert all(p["sourceVersionId"] == svid for p in ev["packed"])
    assert "Lumen" not in term["data"]["answer"]
    assert of_type(events, "citation.validated")


async def test_concise_mock_answers_with_first_cited_sentence(repo):
    svid = await ingest(MARKET, WS_A, "Market Outlook")
    plan = {
        **MOCK_PLAN,
        "primary": {"modelConfigId": "mock-concise", "provider": "mock", "model": "folioverse-mock-concise"},
    }
    full, _, _ = await run("grounded_qa", WS_A, [svid], {"question": QUESTION})
    short, events, _ = await run("grounded_qa", WS_A, [svid], {"question": QUESTION}, plan=plan)
    assert short["data"]["outcome"] == "ANSWERED"
    assert len(short["data"]["answer"]) < len(full["data"]["answer"])
    assert short["data"]["answer"].count("[S") == 1
    assert concise('{"a": 1}') == '{"a": 1}'


async def test_answer_judge_scores_relevance(repo):
    good, _, _ = await run(
        "answer_judge",
        WS_A,
        [],
        {
            "question": "What is the base case annual growth rate?",
            "text": "The base case annual growth rate is 14.2%.",
        },
    )
    verdict = json.loads(good["data"]["answer"])
    assert verdict["score"] >= 4 and "DEMO" in verdict["reason"]
    off, _, _ = await run(
        "answer_judge",
        WS_A,
        [],
        {"question": "What is the base case annual growth rate?", "text": "Penguins live in Antarctica."},
    )
    assert json.loads(off["data"]["answer"])["score"] < verdict["score"]
    broken, _, _ = await run(
        "answer_judge",
        WS_A,
        [],
        {"question": "growth rate?", "text": "growth rate"},
        options={"inject": "malformed_output"},
    )
    assert json.loads(broken["data"]["answer"])["malformed"] is True
