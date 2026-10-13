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
# # 10 · Narrative DNA extraction & continuity evaluation
#
# Writer's Narrative DNA proposes characters, places, facts and relations from a manuscript
# (`dna_extraction` graph); the author approves them into canon, and `continuity_check` flags scenes that
# contradict canon. With the mock model both graphs return their deterministic rule layer
# (`writer.extract_dna`, `writer.detect_conflicts`), which is also what a live model's output is merged with.
#
# Ground truth comes from a templated story generator: every character, place and fact is known. Some facts
# use phrasings the rules cover (`X's eyes were blue`, `X had red hair`, `X was 34 years old`) and some
# deliberately do not (`X, whose eyes were blue, ...`), so recall is not flattered by construction.

# %%
import os
import sys

sys.path.insert(0, os.environ.get("FV_NOTEBOOK_DIR", os.getcwd()))
import fvnb

fvnb.setup()
print("smoke mode" if fvnb.SMOKE else "full mode")

# %% [markdown]
# ## Story generator

# %%
import random

from folioverse_ai.graphs.writer import detect_conflicts, extract_dna

FIRST = [
    "Mara",
    "Jonas",
    "Ilse",
    "Teodor",
    "Wren",
    "Anselm",
    "Petra",
    "Corin",
    "Odile",
    "Lucan",
    "Saskia",
    "Fenn",
    "Bram",
    "Nell",
    "Oskar",
    "Yara",
]
PLACES = [
    "Harrow Quay",
    "Valmere",
    "Ostend Gate",
    "Kestrel Hall",
    "Bellwood",
    "Saltmarsh",
    "Greyhaven",
    "Lantern Row",
]
COLORS = ["blue", "green", "grey", "brown", "amber", "hazel", "black"]
HAIR = ["red", "black", "brown", "silver", "golden", "auburn"]
AGES = {"twelve": "twelve", "nine": "nine", "eleven": "eleven", "34": "34", "51": "51", "27": "27"}
ACTIONS = [
    "{a} walked to {p} before dawn.",
    "In {p}, {a} waited for {b}.",
    "{a} and {b} argued about the letter.",
    "Rain fell on {p} while {a} slept.",
    "Later, {a} found a key near {p}.",
    "Nobody in {p} trusted {b}.",
    "{a} smiled at {b} without a word.",
    "The ferry from {p} carried {a} and {b} north.",
]


def make_story(rng: random.Random, n_chars: int, n_places: int, sentences: int) -> dict:
    chars = rng.sample(FIRST, n_chars)
    places = rng.sample(PLACES, n_places)
    facts, lines = [], []
    for c in chars:
        eye, hair, age = rng.choice(COLORS), rng.choice(HAIR), rng.choice(list(AGES))
        covered = rng.random() < 0.7
        lines.append(f"{c}'s eyes were {eye}." if covered else f"{c}, whose eyes were {eye}, said nothing.")
        facts.append({"name": c, "key": "eyes color", "value": eye, "covered": covered})
        covered = rng.random() < 0.7
        lines.append(f"{c} had {hair} hair." if covered else f"The wind caught {c}'s {hair} hair.")
        facts.append({"name": c, "key": "hair color", "value": hair, "covered": covered})
        if rng.random() < 0.6:
            lines.append(f"{c} was {age} years old.")
            facts.append({"name": c, "key": "age", "value": age, "covered": True})
    for _ in range(sentences):
        a, b = rng.sample(chars, 2)
        lines.append(rng.choice(ACTIONS).format(a=a, b=b, p=rng.choice(places)))
    rng.shuffle(lines)
    text = " ".join(lines)
    truth_chars = {c for c in chars if text.count(c) >= 2}
    truth_places = {p for p in places if text.count(p) >= 2}
    return {
        "text": text,
        "chars": chars,
        "places": places,
        "truthChars": truth_chars,
        "truthPlaces": truth_places,
        "facts": facts,
    }


rng = random.Random(10)
stories = [
    make_story(rng, rng.randint(3, 6), rng.randint(2, 4), rng.randint(10, 30))
    for _ in range(fvnb.sample(200, 25))
]
print(len(stories), "stories; example:\n", stories[0]["text"][:400], "...")

# %% [markdown]
# ## Entity and fact extraction

# %%


def prf(tp: int, fp: int, fn: int) -> dict:
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    return {"precision": p, "recall": r, "f1": 2 * p * r / (p + r) if p + r else 0.0}


ent = {"tp": 0, "fp": 0, "fn": 0, "kind_ok": 0}
fact = {"tp": 0, "fp": 0, "fn_covered": 0, "fn_uncovered": 0, "covered": 0, "uncovered": 0}
false_entities = []
for s in stories:
    dna = extract_dna(s["text"])
    truth = {n: "CHARACTER" for n in s["truthChars"]} | {n: "PLACE" for n in s["truthPlaces"]}
    pred = {e["name"]: e for e in dna["entities"]}
    for name, e in pred.items():
        if name in truth:
            ent["tp"] += 1
            ent["kind_ok"] += e["kind"] == truth[name]
        else:
            ent["fp"] += 1
            false_entities.append(name)
    ent["fn"] += sum(1 for n in truth if n not in pred)
    got = {(e["name"], k, str(v).lower()) for e in dna["entities"] for k, v in e["facts"].items()}
    want = {(f["name"], f["key"], f["value"]) for f in s["facts"]}
    fact["tp"] += len(got & want)
    fact["fp"] += len(got - want)
    for f in s["facts"]:
        bucket = "covered" if f["covered"] else "uncovered"
        fact[bucket] += 1
        if (f["name"], f["key"], f["value"]) not in got:
            fact[f"fn_{bucket}"] += 1

from collections import Counter  # noqa: E402

extraction = [
    {
        "target": "entities",
        **prf(ent["tp"], ent["fp"], ent["fn"]),
        "kind_accuracy": ent["kind_ok"] / ent["tp"] if ent["tp"] else 0.0,
    },
    {"target": "facts", **prf(fact["tp"], fact["fp"], fact["fn_covered"] + fact["fn_uncovered"])},
]
fvnb.table(extraction)
fact_recall = [
    {
        "phrasing": "covered by rules",
        "facts": fact["covered"],
        "recall": 1 - fact["fn_covered"] / fact["covered"] if fact["covered"] else 0.0,
    },
    {
        "phrasing": "not covered",
        "facts": fact["uncovered"],
        "recall": 1 - fact["fn_uncovered"] / fact["uncovered"] if fact["uncovered"] else 0.0,
    },
]
fvnb.table(fact_recall)
print("most frequent false entities:", Counter(false_entities).most_common(6))

# %% [markdown]
# ## Continuity: injected contradictions
#
# Each canon fact gets a contradicting scene, a consistent scene, and (for colours) a "cross-reference" scene
# where the character looks at someone else's trait. The first run of this notebook found four rule defects,
# since fixed in `writer.detect_conflicts` (decision log D-105): age facts were never checked ("34 years old"
# never says "age"), digit values were never matched, canon values matched inside other words ("red" in
# "stared" hid a conflict), and another character's trait was flagged as a contradiction. Because the fixes
# were made against this generator, its scores are an upper bound.

# %%
cases = []
for s in stories:
    canon_facts: dict[str, dict] = {}
    for f in s["facts"]:
        key = {"eyes color": "eye color"}.get(f["key"], f["key"])
        canon_facts.setdefault(f["name"], {})[key] = f["value"]
    canon = [{"id": n, "name": n, "facts": fs} for n, fs in canon_facts.items()]
    for f in s["facts"]:
        name, val = f["name"], f["value"]
        if f["key"] == "age":
            pool = [a for a in AGES if a != val and a.isdigit() == val.isdigit()]
            other = rng.choice(pool)
            kind = "age (digits)" if val.isdigit() else "age (words)"
            scenes = [
                (f"{name} was {other} years old that spring.", True),
                (f"{name} was {val} years old that spring.", False),
            ]
        else:
            palette = COLORS if f["key"] == "eyes color" else HAIR
            other = rng.choice([c for c in palette if c != val])
            part = "eyes" if f["key"] == "eyes color" else "hair"
            kind = f["key"].replace("eyes", "eye")
            scenes = [
                (f"{name}'s {part} looked {other} in the lamplight.", True),
                (f"{name}'s {part} looked {val} in the lamplight.", False),
            ]
            peer = next((c for c in s["chars"] if c != name), None)
            if peer:
                peer_val = canon_facts.get(peer, {}).get("eye color" if part == "eyes" else "hair color")
                if peer_val and peer_val != val:
                    scenes.append((f"{name} stared at {peer}'s {peer_val} {part}.", False))
        for scene, contradicts in scenes:
            issues = [i for i in detect_conflicts(scene, canon) if i["entity"] == name]
            cases.append(
                {
                    "kind": kind,
                    "cross_reference": name in scene and "stared" in scene,
                    "label": contradicts,
                    "flagged": bool(issues),
                }
            )

cont_rows = []
for kind in sorted({c["kind"] for c in cases}):
    cs = [c for c in cases if c["kind"] == kind]
    tp = sum(c["label"] and c["flagged"] for c in cs)
    fp = sum((not c["label"]) and c["flagged"] for c in cs)
    fn = sum(c["label"] and not c["flagged"] for c in cs)
    cont_rows.append({"fact": kind, "cases": len(cs), **prf(tp, fp, fn)})
cross = [c for c in cases if c["cross_reference"]]
cont_rows.append(
    {
        "fact": "cross-reference negatives",
        "cases": len(cross),
        "false_positive_rate": fvnb.mean(c["flagged"] for c in cross),
    }
)
fvnb.table(cont_rows, ["fact", "cases", "precision", "recall", "f1", "false_positive_rate"])

# %% [markdown]
# ## End to end through the graphs

# %%
terminal, events = fvnb.arun(fvnb.run_graph("dna_extraction", [], {"params": {"text": stories[0]["text"]}}))
art = terminal["data"]["artifact"]
same = [e["name"] for e in art["entities"]] == [
    e["name"] for e in extract_dna(stories[0]["text"])["entities"]
]
print(
    f"dna_extraction: {terminal['data']['outcome']}, {len(art['entities'])} entities, {len(art['relations'])} relations, matches rule layer: {same}"
)
canon0 = [
    {"id": f["name"], "name": f["name"], "facts": {"eye color": f["value"]}}
    for f in stories[0]["facts"]
    if f["key"] == "eyes color"
]
probe = f"{canon0[0]['name']}'s eyes looked {'green' if canon0[0]['facts']['eye color'] != 'green' else 'blue'} today."
terminal, _ = fvnb.arun(fvnb.run_graph("continuity_check", [], {"params": {"text": probe, "canon": canon0}}))
print(
    f"continuity_check: {terminal['data']['outcome']}, issues {len(terminal['data']['artifact']['issues'])}"
)

# %% [markdown]
# ## Findings

# %%
fvnb.finding(
    f"Entities: precision {extraction[0]['precision']:.2f}, recall {extraction[0]['recall']:.2f}, kind accuracy {extraction[0]['kind_accuracy']:.2f}."
)
fvnb.finding(
    f"Facts: covered phrasings recall {fact_recall[0]['recall']:.2f}, uncovered phrasings {fact_recall[1]['recall']:.2f}: the rules only see the forms they encode; a live model fills the gap."
)
for r in cont_rows[:-1]:
    fvnb.finding(f"Continuity, {r['fact']}: precision {r['precision']:.2f}, recall {r['recall']:.2f}.")
fvnb.finding(
    f"Cross-reference sentences (another character's trait) are flagged {cont_rows[-1]['false_positive_rate']:.0%} of the time."
)

# %%
fvnb.save(
    "10-narrative-dna",
    {
        "stories": len(stories),
        "extraction": extraction,
        "factRecall": fact_recall,
        "continuity": cont_rows,
        "falseEntities": Counter(false_entities).most_common(10),
    },
)
