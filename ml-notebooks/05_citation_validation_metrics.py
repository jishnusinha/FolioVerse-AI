# ---
# jupyter:
#   jupytext:
#     formats: ipynb,py:percent
#     text_representation:
#       extension: .py
#       format_name: percent
#   kernelspec:
#     display_name: Python 3
#     language: python
#     name: python3
# ---

# %% [markdown]
# # 5 · Citation validation metrics
#
# Every `[S#]` marker in a generated answer is checked deterministically against the packed context
# (`folioverse_ai.citations.validate`): unknown markers are UNRESOLVED; otherwise the claim before the
# marker is scored by content-word containment in the cited text, and `score ≥ 0.45` is VALID, else WEAK.
# The same rule exists in TypeScript; both must pass `packages/contracts/fixtures/citation-cases.json`.
#
# Here the validator is treated as a binary classifier ("is this citation supported?") and measured on
# synthetic answers with known labels:
#
# | case | label | construction |
# |---|---|---|
# | correct | supported | the cited sentence, verbatim |
# | paraphrase-p | supported | a share `p` of the content words kept, the rest swapped for other vocabulary |
# | swapped | unsupported | a correct claim whose marker points at another passage from the same genre |
# | fabricated | unsupported | a sentence from a document that is not in the context |
# | unknown | unsupported | a marker with no packed passage |

# %%
import os
import sys

sys.path.insert(0, os.environ.get("FV_NOTEBOOK_DIR", os.getcwd()))
import fvnb

print("smoke mode" if fvnb.SMOKE else "full mode")

# %% [markdown]
# ## Golden fixtures

# %%
import json

from folioverse_ai.citations import VALID_THRESHOLD, validate

fixtures = json.loads(
    (fvnb.ROOT / "packages/contracts/fixtures/citation-cases.json").read_text(encoding="utf-8")
)
fixture_rows = []
for case in fixtures["cases"]:
    got = {
        m: r.state
        for m, r in validate(case["answer"], {k: {"text": v} for k, v in case["context"].items()}).items()
    }
    fixture_rows.append(
        {"case": case["name"], "expected": case["expected"], "got": got, "pass": got == case["expected"]}
    )
fvnb.table(fixture_rows)
assert all(r["pass"] for r in fixture_rows), "citation fixtures diverge from the contract"

# %% [markdown]
# ## Synthetic labelled answers

# %%
import random

from folioverse_ai.text import STOPWORDS, split_sentences, tokens

rng = random.Random(11)
items = fvnb.catalog()[: fvnb.sample(530, 120)]
sentences = [(d, s) for d in items for s in split_sentences(d["description"]) if len(s.split()) >= 8]
vocab = sorted({t for _, s in sentences for t in tokens(s) if t not in STOPWORDS and len(t) > 3})
by_genre: dict[str, list] = {}
for d, s in sentences:
    by_genre.setdefault(d["genres"][0], []).append((d, s))


def paraphrase(sentence: str, keep: float) -> str:
    out = []
    for w in sentence.rstrip(".").split():
        content = w.lower().strip(",") not in STOPWORDS and len(w) > 3
        out.append(w if not content or rng.random() < keep else rng.choice(vocab))
    return " ".join(out)


KEEPS = (0.8, 0.6, 0.4)
examples = []
for d, s in rng.sample(sentences, fvnb.sample(400, 80)):
    peers = [x for x in by_genre[d["genres"][0]] if x[0]["id"] != d["id"]]
    other = rng.choice(peers)[1] if peers else rng.choice(sentences)[1]
    stranger = rng.choice([x for x in sentences if x[0]["id"] != d["id"]])[1]
    context = {"S1": {"text": s}, "S2": {"text": other}}
    claim = s.rstrip(".")
    examples.append(("correct", True, f"{claim} [S1].", context, "S1"))
    for keep in KEEPS:
        examples.append((f"paraphrase-{keep}", True, f"{paraphrase(s, keep)} [S1].", context, "S1"))
    examples.append(("swapped", False, f"{claim} [S2].", context, "S2"))
    examples.append(("fabricated", False, f"{stranger.rstrip('.')} [S1].", context, "S1"))
    examples.append(("unknown", False, f"{claim} [S7].", context, "S7"))

scored = []
for kind, label, answer, context, marker in examples:
    r = validate(answer, context)[marker]
    scored.append({"kind": kind, "label": label, "state": r.state, "score": r.score})
print(len(scored), "labelled citations")

# %% [markdown]
# ## Outcomes per case at the production threshold

# %%
from collections import Counter, defaultdict

per_kind = defaultdict(Counter)
for r in scored:
    per_kind[r["kind"]][r["state"]] += 1
kind_rows = []
for kind, c in per_kind.items():
    n = sum(c.values())
    kind_rows.append(
        {
            "case": kind,
            "n": n,
            "VALID": c["VALID"] / n,
            "WEAK": c["WEAK"] / n,
            "UNRESOLVED": c["UNRESOLVED"] / n,
            "mean_score": fvnb.mean(r["score"] for r in scored if r["kind"] == kind),
        }
    )
fvnb.table(kind_rows)

# %% [markdown]
# ## Precision / recall across thresholds

# %%


def prf(threshold: float) -> dict:
    tp = sum(r["label"] and r["state"] != "UNRESOLVED" and r["score"] >= threshold for r in scored)
    fp = sum((not r["label"]) and r["state"] != "UNRESOLVED" and r["score"] >= threshold for r in scored)
    fn = sum(r["label"] for r in scored) - tp
    p = tp / (tp + fp) if tp + fp else 1.0
    rc = tp / (tp + fn) if tp + fn else 0.0
    return {
        "threshold": threshold,
        "precision": p,
        "recall": rc,
        "f1": 2 * p * rc / (p + rc) if p + rc else 0.0,
    }


thresholds = [round(0.05 * i, 2) for i in range(1, 20)]
curve = [prf(t) for t in thresholds]
fvnb.table([r for r in curve if r["threshold"] in (0.25, 0.35, 0.45, 0.55, 0.65, 0.75)])
best = max(curve, key=lambda r: r["f1"])
prod = prf(VALID_THRESHOLD)

# %%
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(6, 2.8))
ax.plot(thresholds, [r["precision"] for r in curve], label="precision")
ax.plot(thresholds, [r["recall"] for r in curve], label="recall")
ax.plot(thresholds, [r["f1"] for r in curve], label="F1")
ax.axvline(VALID_THRESHOLD, color="grey", linestyle="--", label="production")
ax.set_xlabel("containment threshold")
ax.legend(fontsize=8)
fig.tight_layout()

# %% [markdown]
# ## Findings

# %%
swapped = next(r for r in kind_rows if r["case"] == "swapped")
fvnb.finding(f"Golden fixtures: {sum(r['pass'] for r in fixture_rows)}/{len(fixture_rows)} pass.")
fvnb.finding(
    f"At the production threshold {VALID_THRESHOLD}: precision {prod['precision']:.3f}, recall {prod['recall']:.3f}, F1 {prod['f1']:.3f}."
)
fvnb.finding(
    f"Best F1 {best['f1']:.3f} at threshold {best['threshold']}; that optimum depends on this synthetic mix of "
    "paraphrases and negatives, so it is a sensitivity check, not a recommendation to move the contract threshold."
)
for keep in KEEPS:
    r = next(x for x in kind_rows if x["case"] == f"paraphrase-{keep}")
    fvnb.finding(
        f"Paraphrase keeping {keep:.0%} of content words: {r['VALID']:.0%} VALID (mean score {r['mean_score']:.2f})."
    )
fvnb.finding(
    f"Swapped markers between same-genre passages are marked VALID {swapped['VALID']:.0%} of the time: passages "
    "with shared wording fool a lexical check, which is why the UI shows the supporting quote for review."
)

# %%
fvnb.save(
    "05-citation-validation",
    {
        "threshold": VALID_THRESHOLD,
        "fixtures": [{"case": r["case"], "pass": r["pass"]} for r in fixture_rows],
        "examples": len(scored),
        "perCase": kind_rows,
        "atProduction": prod,
        "bestF1": best,
        "curve": curve,
    },
)
