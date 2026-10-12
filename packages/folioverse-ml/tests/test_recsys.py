import json
from collections import Counter

import numpy as np
import pytest
from folioverse_ml.artifact import ensure_model, latest_manifest, load, save
from folioverse_ml.data import DEFAULT_CATALOG, DEFAULT_HOLDOUT, load_catalog, load_holdout, sha256_file
from folioverse_ml.evaluate import evaluate
from folioverse_ml.recsys import PRIOR_CAP, Profile, RecModel, Request, effective_weights


@pytest.fixture(scope="module")
def catalog():
    return load_catalog()


@pytest.fixture(scope="module")
def model(catalog):
    return RecModel.train(catalog, load_holdout().train)


def by_id(model, rid):
    return model.items[model.index[rid]]


def test_demo_catalog_is_large_labelled_and_matches_its_manifest(catalog):
    manifest = json.loads((DEFAULT_CATALOG.parent / "manifest.json").read_text(encoding="utf-8"))
    assert len(catalog) >= 500
    assert manifest["sha256"] == sha256_file(DEFAULT_CATALOG)
    assert all(it.is_demo for it in catalog)
    assert len({it.id for it in catalog}) == len(catalog)
    kinds = Counter(it.kind for it in catalog)
    assert kinds["BOOK"] >= 300 and kinds["FILM"] >= 150
    holdout = json.loads((DEFAULT_HOLDOUT / "manifest.json").read_text(encoding="utf-8"))
    assert holdout["catalogSha256"] == manifest["sha256"]


def test_features_are_normalised(model):
    f = model.features
    norms = np.sqrt(np.asarray(f.tfidf.multiply(f.tfidf).sum(axis=1)).ravel())
    assert np.allclose(norms[norms > 0], 1.0, atol=1e-4)
    assert np.allclose(np.linalg.norm(f.embeddings, axis=1), 1.0, atol=1e-4)
    assert f.prior.min() >= 0 and f.prior.max() <= 1


def test_weights_are_normalised_and_the_prior_is_capped():
    w = effective_weights({"semantic": 0, "tfidf": 0, "theme": 0, "preference": 0, "prior": 1})
    assert w["prior"] == PRIOR_CAP and w["semantic"] == 0
    d = effective_weights(None)
    assert abs(sum(d.values()) - 1) < 1e-3
    assert effective_weights({k: 0 for k in d}) == d


def test_scores_decompose_exactly_into_factors(model):
    res = model.recommend(
        Profile(query="atmospheric science fiction about signals and isolation"), Request(k=10)
    )
    assert len(res["items"]) == 10
    for it in res["items"]:
        total = sum(f["contribution"] for f in it["factors"]) + sum(
            a["contribution"] for a in it["adjustments"] if a["key"] == "dislike"
        )
        assert abs(total - it["score"]) < 2e-3
    top = res["items"][0]
    assert {"isolation", "signals"} & set(top["sharedThemes"])
    assert res["profile"]["topThemes"][:2] == ["isolation", "signals"] or set(
        res["profile"]["topThemes"][:2]
    ) == {"isolation", "signals"}
    assert res["stages"]["candidates"]["unique"] >= 10 and res["stages"]["final"] == 10


def test_mmr_caps_creators_franchises_and_balances_media(model, catalog):
    fan = Counter(c for it in catalog for c in it.creators).most_common(1)[0][0]
    liked = [it.id for it in catalog if fan in it.creators][:3]
    res = model.recommend(Profile(positives={i: 1.0 for i in liked}), Request(k=12))
    items = [by_id(model, r["id"]) for r in res["items"]]
    assert not set(liked) & {r["id"] for r in res["items"]}
    assert max(Counter(c for it in items for c in it.creators).values()) <= 2
    franchises = Counter(it.franchise for it in items if it.franchise)
    assert not franchises or max(franchises.values()) <= 2
    assert max(Counter(it.kind for it in items).values()) <= 8
    assert any(r["baseRank"] != r["rank"] for r in res["items"])
    plain = model.recommend(
        Profile(positives={i: 1.0 for i in liked}),
        Request(k=12, mmr_lambda=1.0, per_creator=12, per_franchise=12, balance_media=False),
    )
    assert [r["baseRank"] for r in plain["items"]] == list(range(1, 13))


def test_filters_dislikes_and_cold_start(model):
    films = model.recommend(
        Profile(query="haunted manor folklore"), Request(k=8, kind="FILM", moods=["Dark"])
    )
    assert films["items"] and all(
        by_id(model, r["id"]).kind == "FILM" and "Dark" in by_id(model, r["id"]).moods for r in films["items"]
    )
    first = films["items"][0]["id"]
    again = model.recommend(
        Profile(query="haunted manor folklore", negatives=[first]), Request(k=8, kind="FILM", moods=["Dark"])
    )
    assert first not in {r["id"] for r in again["items"]}
    assert any(a["key"] == "dislike" for r in again["items"] for a in r["adjustments"])
    cold = model.recommend(Profile(), Request(k=6))
    assert cold["coldStart"] and cold["stages"]["candidates"].get("prior") and len(cold["items"]) == 6
    assert cold["items"][0]["rationale"].startswith("A well-rated")


def test_context_documents_explain_recommendations(model):
    ctx = [
        {
            "title": "Orbit of Small Lanterns",
            "text": "A ring station in slow orbit, an archivist cataloguing a library, lanterns lit by an unknown keeper.",
            "weight": 1,
        }
    ]
    res = model.recommend(Profile.from_json({"context": ctx}), Request(k=6))
    assert any((r["becauseOf"] or {}).get("kind") == "library" for r in res["items"])
    assert "space stations" in res["profile"]["topThemes"] or "archives" in res["profile"]["topThemes"]


def test_similar_across_media(model, catalog):
    book = next(it for it in catalog if it.kind == "BOOK" and it.franchise)
    sims = model.similar(book.id, k=4, other_kind=True)
    assert sims and all(s["kind"] == "FILM" for s in sims)


def test_artifact_round_trip_and_checksum(tmp_path, model):
    path = save(model, tmp_path, {"catalogSha256": "x", "interactionsSha256": "y"})
    assert path.name == "rec_model_v1.json" and latest_manifest(tmp_path) == path
    loaded = load(path)
    p, r = Profile(query="a lighthouse above a restless sea"), Request(k=5)
    assert [x["id"] for x in loaded.recommend(p, r)["items"]] == [
        x["id"] for x in model.recommend(p, r)["items"]
    ]
    npz = tmp_path / "rec_model_v1.npz"
    npz.write_bytes(npz.read_bytes() + b"tamper")
    with pytest.raises(ValueError, match="checksum"):
        load(path)


def test_ensure_model_reuses_a_matching_version(tmp_path):
    a = ensure_model(tmp_path, DEFAULT_CATALOG, DEFAULT_HOLDOUT / "train.jsonl", cf_factors=8)
    b = ensure_model(tmp_path, DEFAULT_CATALOG, DEFAULT_HOLDOUT / "train.jsonl", cf_factors=8)
    assert a.manifest["version"] == b.manifest["version"] == 1
    c = ensure_model(tmp_path, DEFAULT_CATALOG, DEFAULT_HOLDOUT / "train.jsonl", cf_factors=12)
    assert c.manifest["version"] == 2 and c.version_label == "recsys-hybrid v2"


def test_offline_evaluation_beats_popularity(model):
    report = evaluate(
        model, load_holdout(), k=10, variants=["popularity", "content", "hybrid_mmr"], max_users=80
    )
    v = {x["name"]: x for x in report["variants"]}
    assert report["users"] == 80 and report["isDemo"]
    for x in v.values():
        for key in ("precision", "recall", "ndcg", "hitRate", "coverage", "popularityPercentile"):
            assert 0 <= x[key] <= 1
    assert v["hybrid_mmr"]["ndcg"] > v["popularity"]["ndcg"]
    assert v["hybrid_mmr"]["coverage"] > v["popularity"]["coverage"]
    assert v["hybrid_mmr"]["popularityPercentile"] < v["popularity"]["popularityPercentile"]
