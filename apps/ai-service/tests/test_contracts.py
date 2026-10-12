"""Golden fixtures shared with the TypeScript side (packages/contracts/fixtures)."""

import json

import pytest
from conftest import CONTRACTS
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from folioverse_ai.anchors import reanchor
from folioverse_ai.citations import validate
from folioverse_ai.events import envelope
from folioverse_ai.pricing import price_usage


def load(name: str) -> dict:
    return json.loads((CONTRACTS / "fixtures" / name).read_text(encoding="utf-8"))


PRICING = load("pricing-cases.json")["cases"]
CITATIONS = load("citation-cases.json")["cases"]
ANCHORS = load("anchor-cases.json")["cases"]


@pytest.mark.parametrize("case", PRICING, ids=[c["name"] for c in PRICING])
def test_pricing_fixture(case):
    r = price_usage(case["prices"], case["usage"], case.get("reported", True))
    assert f"{r.amount:.8f}" == case["expected"]["amount"]
    assert r.status == case["expected"]["status"]
    assert r.reason == case["expected"]["reason"]


@pytest.mark.parametrize("case", CITATIONS, ids=[c["name"] for c in CITATIONS])
def test_citation_fixture(case):
    ctx = {k: {"text": v} for k, v in case["context"].items()}
    res = validate(case["answer"], ctx)
    assert {k: v.state for k, v in res.items()} == case["expected"]


@pytest.mark.parametrize("case", ANCHORS, ids=[c["name"] for c in ANCHORS])
def test_anchor_fixture(case):
    r = reanchor(case["oldText"], case["newText"], case["anchor"])
    for k, v in case["expected"].items():
        assert r[k] == v, (k, r)


def _registry() -> Registry:
    resources = []
    for p in (CONTRACTS / "schemas").glob("*.json"):
        schema = json.loads(p.read_text(encoding="utf-8"))
        resources.append((schema.get("$id", p.name), Resource.from_contents(schema)))
        resources.append((p.name, Resource.from_contents(schema)))
    return Registry().with_resources(resources)


def test_python_envelopes_match_contract():
    schema = json.loads((CONTRACTS / "schemas" / "event-envelope.schema.json").read_text(encoding="utf-8"))
    v = Draft202012Validator(schema, registry=_registry())
    for t, data in [
        ("run.started", {"graph": "grounded_qa"}),
        ("token.delta", {"text": "hi"}),
        ("heartbeat", {}),
        ("ingestion.stage", {"state": "PARSING", "progress": 0.25}),
    ]:
        errors = list(v.iter_errors(envelope(t, data, 1, "0190f0f0-0000-7000-8000-000000000001")))
        assert not errors, [e.message for e in errors]
