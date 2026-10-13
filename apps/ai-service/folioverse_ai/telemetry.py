"""OpenTelemetry tracing (exported only when OTEL_EXPORTER_OTLP_ENDPOINT is set).

Spans use the shared attribute conventions fv.workspace_id, fv.run_id, fv.graph and fv.node.
Attributes carry ids and enums only, never prompts, answers or source text. Without a configured
provider the OpenTelemetry API hands out no-op spans, so tests and local runs are unaffected.
"""

from contextlib import contextmanager

from fastapi import FastAPI
from opentelemetry import trace

from .settings import Settings

ATTR_WORKSPACE = "fv.workspace_id"
ATTR_RUN = "fv.run_id"
ATTR_GRAPH = "fv.graph"
ATTR_NODE = "fv.node"


def tracer() -> trace.Tracer:
    return trace.get_tracer("folioverse-ai")


@contextmanager
def span(name: str, attributes: dict[str, str | int | float | bool | None]):
    clean = {k: v for k, v in attributes.items() if v is not None}
    with tracer().start_as_current_span(name, attributes=clean) as s:
        yield s


def instrument(app: FastAPI, s: Settings) -> None:
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    provider = TracerProvider(
        resource=Resource.create(
            {
                "service.name": f"folioverse-ai-{s.role}",
                "service.namespace": "folioverse",
            }
        )
    )
    provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{s.otel_endpoint.rstrip('/')}/v1/traces"))
    )
    trace.set_tracer_provider(provider)
    # NDJSON work units send one ASGI message per event; per-message spans would bury the graph.
    FastAPIInstrumentor.instrument_app(app, excluded_urls="healthz,readyz", exclude_spans=["receive", "send"])
