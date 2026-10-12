"""Model artifacts: ``rec_model_v{n}.json`` (manifest) + ``rec_model_v{n}.npz`` (arrays, no pickles).

A manifest records the data hashes and parameters it was trained with. ``ensure_model`` reuses the
latest artifact when those match and trains a new version otherwise.
"""

import json
import re
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from .cf import ImplicitCF
from .data import Item, load_catalog, load_interactions, sha256_file
from .features import ContentFeatures
from .recsys import RecModel

NAME = "rec_model"
_V = re.compile(rf"^{NAME}_v(\d+)\.json$")


def versions(directory: Path | str) -> list[int]:
    d = Path(directory)
    if not d.is_dir():
        return []
    return sorted(int(m.group(1)) for p in d.iterdir() if (m := _V.match(p.name)))


def latest_manifest(directory: Path | str) -> Path | None:
    vs = versions(directory)
    return Path(directory) / f"{NAME}_v{vs[-1]}.json" if vs else None


def save(model: RecModel, directory: Path | str, data: dict) -> Path:
    d = Path(directory)
    d.mkdir(parents=True, exist_ok=True)
    vs = versions(d)
    n = (vs[-1] + 1) if vs else 1
    npz = d / f"{NAME}_v{n}.npz"
    f = model.features
    arrays = {
        "vocabulary": np.array(f.vocabulary, dtype=str),
        "idf": f.idf,
        "components": f.components,
        "item_factors": model.cf.item_factors,
        "items": np.array(json.dumps([it.to_json() for it in model.items], ensure_ascii=False), dtype=str),
    }
    if model.cf.item_similarity is not None:
        arrays["item_similarity"] = model.cf.item_similarity.astype(np.float16)
    np.savez_compressed(npz, **arrays)
    manifest = {
        "name": NAME,
        "version": n,
        "label": f"recsys-hybrid v{n}",
        "createdAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "isDemo": all(it.is_demo for it in model.items),
        "algorithm": "TF-IDF + LSA embeddings + theme overlap + NMF implicit CF (NNLS fold-in); MMR diversification",
        "data": data,
        **{k: v for k, v in model.manifest.items() if k in ("params", "training", "vocabulary", "requested")},
        "files": [{"path": npz.name, "sha256": sha256_file(npz), "bytes": npz.stat().st_size}],
    }
    path = d / f"{NAME}_v{n}.json"
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    model.manifest = manifest
    return path


def load(manifest_path: Path | str) -> RecModel:
    path = Path(manifest_path)
    manifest = json.loads(path.read_text(encoding="utf-8"))
    entry = manifest["files"][0]
    npz = path.parent / entry["path"]
    if sha256_file(npz) != entry["sha256"]:
        raise ValueError(f"{npz.name} does not match its manifest checksum")
    with np.load(npz, allow_pickle=False) as z:
        items = [Item.from_json(d) for d in json.loads(str(z["items"]))]
        features = ContentFeatures.from_state(
            items, [str(t) for t in z["vocabulary"]], z["idf"], z["components"]
        )
        sim = z["item_similarity"].astype(np.float32) if "item_similarity" in z.files else None
        cf = ImplicitCF(z["item_factors"].astype(np.float32), sim)
    return RecModel(items, features, cf, manifest)


def ensure_model(
    artifact_dir: Path | str,
    catalog: Path | str,
    interactions: Path | str,
    *,
    lsa_dims: int = 64,
    cf_factors: int = 24,
    seed: int = 0,
) -> RecModel:
    """Loads the latest artifact trained on the same data and parameters, or trains and saves a new version."""
    data = {"catalogSha256": sha256_file(catalog), "interactionsSha256": sha256_file(interactions)}
    params = {"lsaDims": lsa_dims, "cfFactors": cf_factors, "seed": seed}
    latest = latest_manifest(artifact_dir)
    if latest:
        m = json.loads(latest.read_text(encoding="utf-8"))
        if m.get("data") == data and m.get("requested") == params:
            return load(latest)
    model = RecModel.train(
        load_catalog(catalog),
        load_interactions(interactions),
        lsa_dims=lsa_dims,
        cf_factors=cf_factors,
        seed=seed,
    )
    model.manifest["requested"] = params
    save(model, artifact_dir, data)
    return model
