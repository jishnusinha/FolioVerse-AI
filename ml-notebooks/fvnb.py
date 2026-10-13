"""Shared helpers for the FolioVerse ML notebooks.

The notebooks exercise the real ``folioverse_ai`` / ``folioverse_ml`` code in the same hermetic setup as
the test suite: in-memory Qdrant, in-memory repository and checkpointer, the deterministic hash embedder
(fastembed optional) and the DEMO mock model. Nothing here calls a paid provider or the network unless a
notebook explicitly asks for fastembed models outside smoke mode.

``KAGGLE_SMOKE=1`` switches every notebook to tiny samples (CI budget: 2 minutes per notebook). Results are
written to ``datasets/evaluation/results/nb-<name>.json`` (full runs) or ``.../results/smoke/`` (smoke runs,
git-ignored).
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import platform
import sys
import threading
import time
import warnings
from collections.abc import Coroutine, Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, TypeVar

T = TypeVar("T")


def _find_root() -> Path:
    env = os.environ.get("FV_REPO_ROOT")
    if env:
        return Path(env).resolve()
    here = Path.cwd().resolve()
    for p in [here, *here.parents, Path(__file__).resolve().parent, *Path(__file__).resolve().parents]:
        if (p / "datasets" / "synthetic").is_dir() and (p / "apps" / "ai-service").is_dir():
            return p
    raise RuntimeError("Repository root not found; set FV_REPO_ROOT (on Kaggle: the attached dataset path).")


ROOT = _find_root()
DATA = ROOT / "datasets"
SMOKE = os.environ.get("KAGGLE_SMOKE") == "1"
RESULTS = DATA / "evaluation" / "results" / ("smoke" if SMOKE else "")
WS = "0190f0f0-0000-7000-8000-0000000000a1"
DEMO_NOTE = "Synthetic DEMO data and the deterministic mock model; numbers show relative behaviour only."
warnings.filterwarnings("ignore", message="Payload indexes have no effect in the local Qdrant")
# tqdm warns about missing ipywidgets with its install path, which would leak into the committed outputs.
warnings.filterwarnings("ignore", message="IProgress not found")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def sample(n_full: int, n_smoke: int) -> int:
    """Sample size for the current mode."""
    return n_smoke if SMOKE else n_full


# ── async bridge ──────────────────────────────────────────────────────────────────────────────────────
_loop = asyncio.new_event_loop()
threading.Thread(target=_loop.run_forever, name="fvnb-loop", daemon=True).start()


def arun(coro: Coroutine[Any, Any, T]) -> T:  # noqa: UP047 - Kaggle images may run Python 3.11
    """Runs a coroutine on the notebook's persistent event loop (works inside Jupyter and plain Python)."""
    return asyncio.run_coroutine_threadsafe(coro, _loop).result()


# ── hermetic environment ──────────────────────────────────────────────────────────────────────────────
_PRIVATE_PEM: str | None = None


def setup(embedder: str = "hash", rerank: bool = False, **env: str) -> None:
    """Configures the AI service for in-process use and resets all cached singletons."""
    global _PRIVATE_PEM
    if _PRIVATE_PEM is None:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec

        key = ec.generate_private_key(ec.SECP256R1())
        _PRIVATE_PEM = key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        ).decode()
        public = key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        os.environ["FV_INTERNAL_JWT_PUBLIC_KEY"] = public.decode()
    for var in ("DATABASE_URL", "OPENAI_API_KEY", "FV_OLLAMA_URL", "OTEL_EXPORTER_OTLP_ENDPOINT"):
        os.environ.pop(var, None)
    os.environ.update(
        {
            "QDRANT_URL": ":memory:",
            "FV_EMBEDDER": embedder,
            "FV_RERANK": "true" if rerank else "false",
            "FV_CHECKPOINTER": "memory",
            "FV_MOCK_TOKEN_DELAY_MS": "0",
            "ROLE": "all",
            "LOG_LEVEL": "warning",
            **env,
        }
    )
    from folioverse_ai.graphs.checkpoints import reset_checkpointer
    from folioverse_ai.repo import MemoryRepo, set_repo
    from folioverse_ai.retrieval.embedder import get_embedder, get_reranker
    from folioverse_ai.retrieval.store import get_store
    from folioverse_ai.settings import get_settings

    for f in (get_settings, get_store, get_embedder, get_reranker):
        f.cache_clear()
    reset_checkpointer()
    set_repo(MemoryRepo())


def repo():
    from folioverse_ai.repo import get_repo

    return get_repo()


def _sign(claims: dict, ttl: int = 600) -> str:
    import jwt

    if _PRIVATE_PEM is None:
        raise RuntimeError("call fvnb.setup() first")
    now = int(time.time())
    body = {"iss": "folioverse-api", "aud": "folioverse-ai", "iat": now, "exp": now + ttl, **claims}
    return jwt.encode(body, _PRIVATE_PEM, algorithm="ES256")


def scope(svids: Iterable[str], workspace_id: str = WS):
    from folioverse_ai.auth import Scope

    return Scope(run_id="notebook", workspace_id=workspace_id, source_version_ids=tuple(svids))


MOCK_PLAN = {
    "primary": {"modelConfigId": "mock-grounded", "provider": "mock", "model": "folioverse-mock-1"},
    "fallbacks": [],
    "maxOutputTokens": 800,
    "temperature": 0.2,
    "isDemo": True,
}


async def ingest(data: bytes | str, title: str, mime: str = "text/markdown", workspace_id: str = WS) -> str:
    """Runs the real ingestion pipeline (parse → chunk → embed → index) and returns the source version id."""
    from folioverse_ai.events import Emitter
    from folioverse_ai.ids import uuid7
    from folioverse_ai.ingestion.pipeline import run_ingestion

    svid = uuid7()
    res = await run_ingestion(
        {
            "jobId": uuid7(),
            "workspaceId": workspace_id,
            "sourceId": uuid7(),
            "sourceVersionId": svid,
            "title": title,
            "mimeType": mime,
            "objectUrl": "unused",
        },
        Emitter(None, workspace_id),
        data=data if isinstance(data, bytes) else data.encode(),
    )
    if res.get("state") != "READY":
        raise RuntimeError(f"ingestion of {title!r} ended in {res.get('state')}: {res.get('error')}")
    return svid


async def run_graph(
    graph: str,
    svids: list[str],
    inp: dict,
    options: dict | None = None,
    plan: dict | None = None,
    workspace_id: str = WS,
) -> tuple[dict, list[dict]]:
    """Executes one run work unit exactly as the API worker would; returns (terminal event, all events)."""
    from folioverse_ai.events import Emitter
    from folioverse_ai.graphs.runner import run_unit
    from folioverse_ai.ids import uuid7

    run_id = uuid7()
    em = Emitter(run_id, workspace_id)
    req = {
        "runId": run_id,
        "workspaceId": workspace_id,
        "graph": graph,
        "input": inp,
        "history": [],
        "modelPlan": plan or MOCK_PLAN,
        "scopeToken": _sign({"sub": run_id, "typ": "scope", "wid": workspace_id, "svids": svids}),
        "options": options or {},
    }
    await run_unit(req, em)
    events = []
    while not em.queue.empty():
        e = em.queue.get_nowait()
        if e is not None:
            events.append(e)
    terminal = next(e for e in reversed(events) if e["type"] in ("run.finished", "run.failed"))
    return terminal, events


# ── data ──────────────────────────────────────────────────────────────────────────────────────────────
def jsonl(path: Path | str) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def qa_small() -> list[dict]:
    return jsonl(DATA / "evaluation" / "qa-small.jsonl")


def catalog() -> list[dict]:
    return jsonl(DATA / "synthetic" / "catalog" / "catalog.jsonl")


def demo_prices() -> dict[str, dict]:
    """DEMO prices of the mock models from the registry seed (not provider prices)."""
    import yaml

    seed = yaml.safe_load((ROOT / "config" / "models" / "registry.seed.yaml").read_text(encoding="utf-8"))
    return {m["id"]: m["demoPrice"] for m in seed["models"] if m.get("demoPrice")}


# ── metrics ───────────────────────────────────────────────────────────────────────────────────────────
def ndcg(ranked: list, gains: dict, k: int) -> float:
    """nDCG@k with graded gains (missing items have gain 0)."""
    dcg = sum(gains.get(x, 0.0) / math.log2(r + 2) for r, x in enumerate(ranked[:k]))
    ideal = sorted(gains.values(), reverse=True)[:k]
    idcg = sum(g / math.log2(r + 2) for r, g in enumerate(ideal))
    return dcg / idcg if idcg else 0.0


def recall(ranked: list, relevant: set, k: int) -> float:
    return len(set(ranked[:k]) & relevant) / len(relevant) if relevant else 0.0


def mrr(ranked: list, relevant: set) -> float:
    return next((1.0 / (r + 1) for r, x in enumerate(ranked) if x in relevant), 0.0)


def mean(xs: Iterable[float]) -> float:
    xs = list(xs)
    return sum(xs) / len(xs) if xs else 0.0


def percentile(xs: list[float], p: float) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    i = (len(s) - 1) * p
    lo, hi = math.floor(i), math.ceil(i)
    return s[lo] + (s[hi] - s[lo]) * (i - lo)


# ── output ────────────────────────────────────────────────────────────────────────────────────────────
def table(rows: list[dict], cols: list[str] | None = None, digits: int = 3):
    """Renders rows as a Markdown table (shown as a table in Jupyter, readable as text elsewhere)."""
    cols = (cols or list(rows[0])) if rows else []

    def fmt(v):
        if isinstance(v, float):
            return f"{v:.{digits}f}"
        return "" if v is None else str(v)

    lines = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    lines += ["| " + " | ".join(fmt(r.get(c)) for c in cols) + " |" for r in rows]
    text = "\n".join(lines)
    try:
        from IPython import get_ipython
        from IPython.display import Markdown, display

        if get_ipython() is not None:
            display(Markdown(text))
            return None
    except ImportError:
        pass
    print(text)
    return None


_FINDINGS: list[str] = []


def finding(text: str) -> None:
    """Prints one finding and records it for `save` (Studio's Evaluation tab shows the saved findings)."""
    _FINDINGS.append(text)
    print(f"- {text}")


def save(name: str, payload: dict) -> None:
    """Writes the notebook's metrics and findings; full runs are committed as reference results, smoke runs are not.

    Returns nothing so a trailing call does not display the absolute path in the committed notebook outputs.
    """
    RESULTS.mkdir(parents=True, exist_ok=True)
    path = RESULTS / f"nb-{name}.json"
    body = {
        "notebook": name,
        "smoke": SMOKE,
        "isDemo": True,
        "note": DEMO_NOTE,
        "python": platform.python_version(),
        "createdAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "findings": list(_FINDINGS),
        **payload,
    }
    path.write_text(json.dumps(body, indent=2, default=str) + "\n", encoding="utf-8")
    print(f"saved {path.relative_to(ROOT).as_posix()}")


class Timer:
    def __enter__(self):
        self.t0 = time.perf_counter()
        return self

    def __exit__(self, *exc):
        self.seconds = time.perf_counter() - self.t0
