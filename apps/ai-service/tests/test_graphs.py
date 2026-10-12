from conftest import MOCK_PLAN
from corpus import MARKET, NOVEL, OTHER_TENANT_DOC
from helpers import ingest, of_type, run

from folioverse_ai.graphs.checkpoints import list_checkpoints
from folioverse_ai.graphs.registry import GRAPHS, describe

WS_A = "0190f0f0-0000-7000-8000-0000000000a1"
WS_B = "0190f0f0-0000-7000-8000-0000000000b2"


async def test_grounded_answer_with_valid_citations(repo):
    svid = await ingest(MARKET, WS_A, "Market Outlook")
    term, events, _ = await run(
        "grounded_qa",
        WS_A,
        [svid],
        {"question": "What annual growth does the base case project through 2030?"},
    )
    assert term["type"] == "run.finished"
    assert term["data"]["outcome"] == "ANSWERED", term
    assert "14.2%" in term["data"]["answer"]
    cites = of_type(events, "citation.validated")
    assert cites and all(c["data"]["state"] == "VALID" for c in cites)
    assert cites[0]["data"]["anchor"]["sourceVersionId"] == svid
    usage = of_type(events, "usage.recorded")
    assert len(usage) == 1 and usage[0]["data"]["isDemo"] is True
    assert of_type(events, "token.delta")


async def test_abstains_without_model_call(repo):
    svid = await ingest(MARKET, WS_A)
    term, events, _ = await run(
        "grounded_qa", WS_A, [svid], {"question": "Who painted the ceiling of the Sistine Chapel?"}
    )
    assert term["data"]["outcome"] == "ABSTAINED"
    assert not of_type(events, "usage.recorded")
    assert not [u for u in repo.usage_events if u.get("cost_class") != "LOCAL_COMPUTE"]


async def test_scope_isolation_between_workspaces(repo):
    secret = await ingest(OTHER_TENANT_DOC, WS_B, "Merger memo")
    mine = await ingest(MARKET, WS_A)
    # Even if a scope token for WS_A lists WS_B's version id, the workspace filter excludes it.
    term, events, _ = await run(
        "grounded_qa",
        WS_A,
        [mine, secret],
        {"question": "Which company will Project Nightjar acquire and for how much?"},
    )
    answer = term["data"].get("answer", "")
    assert "Lumen" not in answer and "2.3 billion" not in answer
    for r in of_type(events, "retrieval.completed"):
        assert all(s["sourceVersionId"] != secret for s in r["data"]["sources"])


async def test_scope_token_must_match_run(repo):
    svid = await ingest(MARKET, WS_A)
    from conftest import scope_token

    from folioverse_ai.events import Emitter
    from folioverse_ai.graphs.runner import run_unit

    em = Emitter("r1", WS_A)
    await run_unit(
        {
            "runId": "r1",
            "workspaceId": WS_A,
            "graph": "grounded_qa",
            "input": {"question": "growth"},
            "modelPlan": MOCK_PLAN,
            "scopeToken": scope_token("other-run", WS_A, [svid]),
        },
        em,
    )
    assert em.history[-1]["type"] == "run.failed"
    assert em.history[-1]["data"]["errorClass"] == "SCOPE_INVALID"


async def test_fallback_on_injected_timeout(repo):
    svid = await ingest(MARKET, WS_A)
    plan = {
        **MOCK_PLAN,
        "fallbacks": [
            {"modelConfigId": "mock-fallback", "provider": "mock", "model": "folioverse-mock-fallback"}
        ],
    }
    term, events, _ = await run(
        "grounded_qa",
        WS_A,
        [svid],
        {"question": "What annual growth does the base case project?"},
        plan=plan,
        options={"inject": "provider_timeout"},
    )
    usage = [e["data"] for e in of_type(events, "usage.recorded")]
    assert [u["status"] for u in usage] == ["ERROR", "OK"]
    assert usage[0]["errorClass"] == "TIMEOUT" and usage[1]["attempt"] == 2
    assert term["type"] == "run.finished"


async def test_timeout_without_fallback_fails_retryable(repo):
    svid = await ingest(MARKET, WS_A)
    term, _, _ = await run(
        "grounded_qa",
        WS_A,
        [svid],
        {"question": "What annual growth does the base case project?"},
        options={"inject": "provider_429"},
    )
    assert term["type"] == "run.failed"
    assert term["data"]["errorClass"] == "PROVIDER_RATE_LIMIT" and term["data"]["retryable"] is True


async def test_retrieval_down_injection(repo):
    svid = await ingest(MARKET, WS_A)
    term, _, _ = await run(
        "grounded_qa", WS_A, [svid], {"question": "growth"}, options={"inject": "retrieval_down"}
    )
    assert term["data"]["errorClass"] == "RETRIEVAL_UNAVAILABLE"


async def test_malformed_output_marks_partial(repo):
    svid = await ingest(MARKET, WS_A)
    term, events, _ = await run(
        "grounded_qa",
        WS_A,
        [svid],
        {"question": "What annual growth does the base case project?"},
        options={"inject": "malformed_output"},
    )
    assert term["data"]["outcome"] == "PARTIAL"
    assert any(c["data"]["state"] == "UNRESOLVED" for c in of_type(events, "citation.validated"))


async def test_insight_actions(repo):
    svid = await ingest(MARKET, WS_A)
    for action in ("quick_summary", "flashcards", "quiz", "risks"):
        term, _, _ = await run("insight", WS_A, [svid], {"action": action})
        assert term["type"] == "run.finished", (action, term)
        art = term["data"]["artifact"]
        assert art["kind"] == action
        if action in ("flashcards", "quiz"):
            assert art["content"]["items"], action
    term, _, _ = await run("risk_contradiction", WS_A, [svid], {})
    assert "Supply chain" in term["data"]["answer"]


async def test_compare_and_knowledge_map(repo):
    a = await ingest(MARKET, WS_A, "v1")
    from corpus import MARKET_V2

    b = await ingest(MARKET_V2, WS_A, "v2")
    term, _, _ = await run("multi_doc_compare", WS_A, [a, b], {})
    assert "## Document 1" in term["data"]["answer"] and "## Document 2" in term["data"]["answer"]
    n = await ingest(NOVEL, WS_A, "Novel")
    term, events, _ = await run("knowledge_map", WS_A, [n], {})
    nodes = term["data"]["artifact"]["content"]["nodes"]
    assert {"Mara", "Tomas"} <= {x["label"] for x in nodes}
    cited = {e["data"]["marker"]: e["data"] for e in events if e["type"] == "citation.validated"}
    assert {x["marker"] for x in nodes if x["marker"]} <= set(cited)
    assert all(c["state"] == "VALID" and c.get("anchor") for c in cited.values())
    term, events, _ = await run("knowledge_map", WS_A, [a], {})
    assert term["data"]["artifact"]["content"]["nodes"], "non-fiction falls back to key concepts"
    assert any(e["type"] == "citation.validated" for e in events)


async def test_research_writing_bounded_tool_loop(repo):
    svid = await ingest(MARKET, WS_A)
    term, events, _ = await run(
        "research_writing",
        WS_A,
        [svid],
        {"question": "Assess growth prospects and risks"},
        options={"maxToolCalls": 2},
    )
    assert len(of_type(events, "retrieval.completed")) == 2
    assert term["type"] == "run.finished" and "[S" in term["data"]["answer"]


async def test_writer_graphs(repo):
    canon = [{"id": "c1", "name": "Mara", "facts": {"eye color": "green"}}]
    term, _, _ = await run(
        "continuity_check",
        WS_A,
        [],
        {"params": {"text": "Mara looked up, her blue eyes narrowing.", "canon": canon}},
    )
    issues = term["data"]["artifact"]["issues"]
    assert issues and issues[0]["expected"] == "green" and issues[0]["found"] == "blue"

    term, _, _ = await run("dna_extraction", WS_A, [], {"text": NOVEL})
    ents = {e["name"]: e for e in term["data"]["artifact"]["entities"]}
    assert ents["Mara"]["facts"].get("eyes color") == "green"
    assert ents["Veldt Harbor"]["kind"] == "PLACE"

    term, _, _ = await run(
        "writer_revision",
        WS_A,
        [],
        {"text": "It was very dark. She just waited. The door opened.", "params": {"mode": "shorten"}},
    )
    assert len(term["data"]["artifact"]["variants"]) == 2


async def test_passage_explain_spoiler_guard(repo):
    svid = await ingest(NOVEL * 6, WS_A, "Novel")
    term, events, _ = await run(
        "passage_explain",
        WS_A,
        [svid],
        {"question": "Mara crossed the bridge at dawn.", "params": {"page": 1}},
    )
    for r in of_type(events, "retrieval.completed"):
        assert all((s.get("page") or 1) <= 1 for s in r["data"]["sources"])
    assert term["type"] == "run.finished"


async def test_checkpoints_and_fork(repo):
    svid = await ingest(MARKET, WS_A)
    _, _, parent = await run(
        "grounded_qa", WS_A, [svid], {"question": "What annual growth does the base case project?"}
    )
    cps = await list_checkpoints(parent)
    assert len(cps) >= 4
    before_generate = next(c for c in cps if c["next"] == ["generate"])
    term, events, child = await run(
        "grounded_qa",
        WS_A,
        [svid],
        {"question": "What annual growth does the base case project?"},
        resumeFromCheckpoint=before_generate["checkpointId"],
        parentRunId=parent,
    )
    assert term["type"] == "run.finished"
    nodes = [e["data"]["node"] for e in of_type(events, "node.started")]
    assert "retrieve" not in nodes and "generate" in nodes
    assert child != parent


def test_registry_describes_every_graph():
    for name in GRAPHS:
        d = describe(name)
        assert d["nodes"] and d["edges"], name
