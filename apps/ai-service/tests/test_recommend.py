from conftest import internal_token
from fastapi.testclient import TestClient
from helpers import of_type, run

from folioverse_ai import recommend
from folioverse_ai.main import create_app

WS = "0190f0f0-0000-7000-8000-0000000000e7"
AUTH = {"authorization": f"Bearer {internal_token()}"}


def client(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setenv("FV_REC_ARTIFACT_DIR", str(tmp_path))
    from folioverse_ai.settings import get_settings

    get_settings.cache_clear()
    recommend.reset_model()
    return TestClient(create_app())


def test_recommendation_routes_need_the_service_token(tmp_path, monkeypatch):
    c = client(tmp_path, monkeypatch)
    assert c.post("/internal/recommendations", json={"requestId": "r", "workspaceId": WS}).status_code == 401


def test_recommends_explains_and_versions_the_model(tmp_path, monkeypatch):
    c = client(tmp_path, monkeypatch)
    body = {
        "requestId": "r1",
        "workspaceId": WS,
        "profile": {"query": "a lighthouse above a restless sea", "moods": ["Atmospheric"]},
        "request": {"k": 8, "lambda": 0.7},
    }
    r = c.post("/internal/recommendations", json=body, headers=AUTH)
    assert r.status_code == 200
    res = r.json()
    assert res["modelVersion"] == "recsys-hybrid v1" and len(res["items"]) == 8
    top = res["items"][0]
    assert {f["key"] for f in top["factors"]} == {"semantic", "tfidf", "theme", "preference", "prior"}
    assert "the sea" in res["profile"]["topThemes"]
    assert res["stages"]["final"] == 8 and res["stages"]["candidates"]["unique"] >= 8
    assert (tmp_path / "rec_model_v1.json").exists()

    lab = c.post(
        "/internal/recommendations",
        json={
            **body,
            "request": {
                "k": 8,
                "lambda": 1.0,
                "weights": {"prior": 1, "semantic": 0, "tfidf": 0, "theme": 0, "preference": 0},
            },
        },
        headers=AUTH,
    ).json()
    assert lab["weights"]["prior"] == 0.1 and [i["id"] for i in lab["items"]] != [
        i["id"] for i in res["items"]
    ]

    sim = c.post(
        "/internal/recommendations/similar",
        json={"itemId": top["id"], "k": 3, "otherKind": True},
        headers=AUTH,
    ).json()
    assert all(s["kind"] != top["kind"] for s in sim["items"])
    m = c.get("/internal/recommendations/model", headers=AUTH).json()
    assert m["version"] == 1 and m["isDemo"] and m["files"][0]["sha256"]

    report = c.post("/internal/recommendations/evaluate", json={"k": 10, "maxUsers": 30}, headers=AUTH).json()
    assert report["users"] == 30 and report["model"]["version"] == 1
    assert {v["name"] for v in report["variants"]} >= {"popularity", "hybrid_mmr"}


def test_missing_catalog_is_reported_as_unavailable(tmp_path, monkeypatch):
    monkeypatch.setenv("FV_REC_CATALOG", str(tmp_path / "none.jsonl"))
    c = client(tmp_path, monkeypatch)
    r = c.post("/internal/recommendations", json={"requestId": "r", "workspaceId": WS}, headers=AUTH)
    assert r.status_code == 503
    monkeypatch.delenv("FV_REC_CATALOG")
    recommend.reset_model()


async def test_rec_explain_uses_only_logged_signals():
    params = {
        "item": {
            "title": "The Quiet Array",
            "kind": "BOOK",
            "moods": ["Atmospheric"],
            "themes": ["isolation", "signals"],
        },
        "factors": [
            {
                "key": "semantic",
                "label": "Semantic affinity",
                "value": 0.8,
                "weight": 0.35,
                "contribution": 0.28,
            },
            {"key": "theme", "label": "Theme overlap", "value": 0.9, "weight": 0.2, "contribution": 0.18},
            {
                "key": "prior",
                "label": "Quality prior (capped)",
                "value": 0.5,
                "weight": 0.05,
                "contribution": 0.025,
            },
        ],
        "sharedThemes": ["isolation", "signals"],
        "becauseOf": {"kind": "library", "title": "Orbit of Small Lanterns"},
    }
    terminal, events, _ = await run("rec_explain", WS, [], {"text": "why", "params": params})
    assert terminal["type"] == "run.finished" and terminal["data"]["status"] == "SUCCEEDED"
    answer = terminal["data"]["answer"]
    assert "semantic affinity and theme overlap" in answer and "Orbit of Small Lanterns" in answer
    usage = of_type(events, "usage.recorded")
    assert usage and usage[0]["data"]["isDemo"] is True
