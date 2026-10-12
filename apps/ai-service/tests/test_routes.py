import json

from conftest import MOCK_PLAN, internal_token, scope_token, sign
from corpus import MARKET
from fastapi.testclient import TestClient
from helpers import ingest

from folioverse_ai.main import create_app

WS = "0190f0f0-0000-7000-8000-0000000000c3"


def client() -> TestClient:
    return TestClient(create_app())


def test_health():
    r = client().get("/healthz")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_internal_routes_require_service_token():
    c = client()
    assert c.get("/internal/providers").status_code == 401
    assert c.get("/internal/providers", headers={"authorization": "Bearer nope"}).status_code == 401
    wrong_typ = sign({"sub": "x", "typ": "scope", "wid": WS, "svids": []})
    assert c.get("/internal/providers", headers={"authorization": f"Bearer {wrong_typ}"}).status_code == 401
    r = c.get("/internal/providers", headers={"authorization": f"Bearer {internal_token()}"})
    assert r.status_code == 200 and r.json()["available"] == ["mock"]


def test_graph_description():
    r = client().get("/internal/graphs/grounded_qa", headers={"authorization": f"Bearer {internal_token()}"})
    assert r.status_code == 200
    ids = {n["id"] for n in r.json()["nodes"]}
    assert {"retrieve", "abstain", "generate", "validate_citations", "finalize"} <= ids


async def test_run_unit_streams_ndjson(repo):
    svid = await ingest(MARKET, WS)
    run_id = "0190f0f0-0000-7000-8000-0000000000d4"
    body = {
        "runId": run_id,
        "workspaceId": WS,
        "graph": "grounded_qa",
        "input": {"question": "What annual growth does the base case project through 2030?"},
        "modelPlan": MOCK_PLAN,
        "scopeToken": scope_token(run_id, WS, [svid]),
    }
    with client().stream(
        "POST", "/internal/runs/units", json=body, headers={"authorization": f"Bearer {internal_token()}"}
    ) as r:
        assert r.status_code == 200
        events = [json.loads(line) for line in r.iter_lines() if line]
    types = [e["type"] for e in events]
    assert types[0] == "run.started" and types[-1] == "run.finished"
    seqs = [e["seq"] for e in events]
    assert seqs == sorted(seqs)
