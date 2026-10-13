from conftest import MOCK_PLAN, internal_token, scope_token
from corpus import MARKET
from fastapi.testclient import TestClient
from helpers import ingest
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from folioverse_ai import telemetry
from folioverse_ai.main import create_app

WS = "0190f0f0-0000-7000-8000-0000000000e1"
TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736"


async def test_run_unit_joins_caller_trace_with_node_spans(repo, monkeypatch):
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    monkeypatch.setattr(telemetry, "tracer", lambda: provider.get_tracer("test"))
    app = create_app()
    FastAPIInstrumentor.instrument_app(app, tracer_provider=provider)

    svid = await ingest(MARKET, WS)
    run_id = "0190f0f0-0000-7000-8000-0000000000e2"
    body = {
        "runId": run_id,
        "workspaceId": WS,
        "graph": "grounded_qa",
        "input": {"question": "What annual growth does the base case project through 2030?"},
        "modelPlan": MOCK_PLAN,
        "scopeToken": scope_token(run_id, WS, [svid]),
    }
    headers = {
        "authorization": f"Bearer {internal_token()}",
        "traceparent": f"00-{TRACE_ID}-00f067aa0ba902b7-01",
    }
    with TestClient(app).stream("POST", "/internal/runs/units", json=body, headers=headers) as r:
        assert r.status_code == 200
        lines = [line for line in r.iter_lines() if line]
    assert lines

    spans = exporter.get_finished_spans()
    run_span = next(s for s in spans if s.name == "run grounded_qa")
    assert format(run_span.context.trace_id, "032x") == TRACE_ID
    assert run_span.attributes["fv.run_id"] == run_id
    assert run_span.attributes["fv.workspace_id"] == WS

    nodes = [s for s in spans if s.name.startswith("node ")]
    assert {s.attributes["fv.node"] for s in nodes} >= {"retrieve", "generate", "finalize"}
    for s in nodes:
        assert format(s.context.trace_id, "032x") == TRACE_ID
        assert s.attributes["fv.graph"] == "grounded_qa"
        assert set(s.attributes) <= {"fv.run_id", "fv.workspace_id", "fv.graph", "fv.node", "fv.step"}
