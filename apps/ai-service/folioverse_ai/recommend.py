"""Recommendations from the folioverse-ml hybrid model.

The model is loaded (or trained and saved as a new artifact version) on first use and kept in memory.
Scoring is CPU-only numpy and never calls a language model, so it is not metered. Profiles arrive from
the API per request; nothing about them is logged or stored here.
"""

import asyncio
import threading
from pathlib import Path

from folioverse_ml.artifact import ensure_model
from folioverse_ml.data import DEFAULT_CATALOG, DEFAULT_HOLDOUT, REPO_ROOT, load_holdout
from folioverse_ml.evaluate import evaluate
from folioverse_ml.recsys import Profile, RecModel, Request

from .settings import get_settings

_lock = threading.Lock()
_model: RecModel | None = None

MANIFEST_KEYS = (
    "name",
    "version",
    "label",
    "createdAt",
    "isDemo",
    "algorithm",
    "data",
    "params",
    "training",
    "vocabulary",
    "files",
)


def paths() -> tuple[Path, Path, Path]:
    s = get_settings()
    catalog = Path(s.rec_catalog) if s.rec_catalog else DEFAULT_CATALOG
    holdout = Path(s.rec_holdout) if s.rec_holdout else DEFAULT_HOLDOUT
    artifacts = Path(s.rec_artifact_dir) if s.rec_artifact_dir else REPO_ROOT / ".data" / "rec-artifacts"
    return catalog, holdout, artifacts


def get_model() -> RecModel:
    global _model
    with _lock:
        if _model is None:
            catalog, holdout, artifacts = paths()
            if not catalog.exists() or not (holdout / "train.jsonl").exists():
                raise FileNotFoundError("Recommendation catalog or training data is missing")
            _model = ensure_model(artifacts, catalog, holdout / "train.jsonl")
        return _model


def reset_model() -> None:
    global _model
    with _lock:
        _model = None


def manifest() -> dict:
    m = get_model().manifest
    return {k: m[k] for k in MANIFEST_KEYS if k in m}


async def recommend(profile: dict, request: dict) -> dict:
    model = await asyncio.to_thread(get_model)
    return await asyncio.to_thread(model.recommend, Profile.from_json(profile), Request.from_json(request))


async def similar(item_id: str, k: int, other_kind: bool) -> list[dict]:
    model = await asyncio.to_thread(get_model)
    return model.similar(item_id, k=k, other_kind=other_kind)


async def offline_evaluation(k: int = 10, max_users: int | None = None) -> dict:
    model = await asyncio.to_thread(get_model)
    _, holdout, _ = paths()
    report = await asyncio.to_thread(evaluate, model, load_holdout(holdout), k, None, max_users)
    report["model"] = {key: model.manifest.get(key) for key in ("version", "label", "createdAt", "data")}
    return report
