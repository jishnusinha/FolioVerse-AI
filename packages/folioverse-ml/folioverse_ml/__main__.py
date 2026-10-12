"""Command line: train an artifact or write an offline evaluation report.

python -m uv run --package folioverse-ml python -m folioverse_ml train
python -m uv run --package folioverse-ml python -m folioverse_ml evaluate --out datasets/evaluation/results/rec_eval.json
"""

import argparse
import json
from pathlib import Path

from .artifact import ensure_model
from .data import DEFAULT_CATALOG, DEFAULT_HOLDOUT, REPO_ROOT, load_holdout
from .evaluate import evaluate


def main() -> None:
    p = argparse.ArgumentParser(prog="folioverse_ml")
    p.add_argument("command", choices=["train", "evaluate"])
    p.add_argument("--catalog", default=str(DEFAULT_CATALOG))
    p.add_argument("--holdout", default=str(DEFAULT_HOLDOUT))
    p.add_argument("--artifacts", default=str(REPO_ROOT / ".data" / "rec-artifacts"))
    p.add_argument("--k", type=int, default=10)
    p.add_argument("--out", default=None)
    a = p.parse_args()

    model = ensure_model(a.artifacts, a.catalog, Path(a.holdout) / "train.jsonl")
    if a.command == "train":
        print(
            json.dumps({k: model.manifest[k] for k in ("label", "createdAt", "training", "files")}, indent=2)
        )
        return
    report = evaluate(model, load_holdout(a.holdout), k=a.k)
    text = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
    if a.out:
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_text(text, encoding="utf-8")
    for v in report["variants"]:
        print(
            f"{v['name']:<11} P@{a.k}={v['precision']:.3f} R@{a.k}={v['recall']:.3f} nDCG={v['ndcg']:.3f} cov={v['coverage']:.2f} ILD={v['diversity']:.3f} pop={v['popularityPercentile']:.2f}"
        )


if __name__ == "__main__":
    main()
