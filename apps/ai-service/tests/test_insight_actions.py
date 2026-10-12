"""Every registered insight action runs on its graph and yields an artifact; semantic search honours the scope."""

import json

import pytest
from conftest import ROOT, internal_token, scope_token
from corpus import MARKET, OTHER_TENANT_DOC
from fastapi.testclient import TestClient
from helpers import ingest, run

from folioverse_ai.graphs.artifacts import TASKS
from folioverse_ai.graphs.registry import GRAPHS
from folioverse_ai.main import create_app

REGISTRY = json.loads(
    (ROOT / "packages" / "contracts" / "fixtures" / "insight-actions.json").read_text("utf-8")
)
ACTIONS = REGISTRY["actions"]
WS = "0190f0f0-0000-7000-8000-0000000000f5"
WS_OTHER = "0190f0f0-0000-7000-8000-0000000000f6"


def test_registry_has_fourteen_actions_with_tasks_and_graphs():
    assert len(ACTIONS) == 14
    assert len({a["id"] for a in ACTIONS}) == 14
    for a in ACTIONS:
        assert a["id"] in TASKS, a["id"]
        assert a["graph"] in GRAPHS, a["graph"]


@pytest.mark.parametrize("action", ACTIONS, ids=lambda a: a["id"])
async def test_action_produces_its_artifact(repo, action):
    svids = [await ingest(MARKET, WS, "Market Outlook")]
    if action["minSources"] > 1:
        svids.append(await ingest(MARKET.replace("14.2%", "11.0%"), WS, "Market Outlook (revised)"))
    term, _, _ = await run(
        action["graph"], WS, svids, {"action": action["id"], "params": {"action": action["id"]}}
    )
    data = term["data"]
    assert data["status"] in ("SUCCEEDED", "PARTIAL"), data
    assert data["artifact"]["kind"] == action["id"]
    assert set(data["artifact"]["sourceVersionIds"]) <= set(svids)


def test_search_requires_matching_scope_and_stays_in_workspace(repo):
    import asyncio

    mine = asyncio.run(ingest(MARKET, WS))
    theirs = asyncio.run(ingest(OTHER_TENANT_DOC, WS_OTHER))
    c = TestClient(create_app())
    auth = {"authorization": f"Bearer {internal_token()}"}
    body = {"searchId": "s-1", "workspaceId": WS, "query": "annual growth base case", "topK": 5}

    bad = c.post(
        "/internal/search", json={**body, "scopeToken": scope_token("other", WS, [mine])}, headers=auth
    )
    assert bad.status_code == 401

    tok = scope_token("s-1", WS, [mine, theirs])
    r = c.post("/internal/search", json={**body, "scopeToken": tok}, headers=auth)
    assert r.status_code == 200
    items = r.json()["items"]
    assert items and all(i["sourceVersionId"] == mine for i in items)
    assert any("14.2%" in i["snippet"] for i in items)
