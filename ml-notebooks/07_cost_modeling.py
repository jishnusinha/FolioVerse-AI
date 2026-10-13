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
# # 7 · Cost modeling & token economics
#
# Every model call is metered (`usage.recorded`) and priced with `folioverse_ai.pricing.price_usage`, which
# must agree with the API ledger on `packages/contracts/fixtures/pricing-cases.json`. This notebook:
#
# 1. checks the Python pricing function against the golden fixtures;
# 2. measures real token usage of `grounded_qa` runs across context budgets (cost driver vs answer quality);
# 3. projects monthly spend for usage scenarios, including prompt caching, batch discounts and abstention.
#
# **All prices here are the DEMO prices of the two mock models in `config/models/registry.seed.yaml`
# (`sourceUrl: demo://not-a-real-provider-price`).** They show the shape of the economics, not what any provider
# charges. Real prices are entered by an admin with a source URL; plug them into `PRICES` to model them.

# %%
import os
import sys

sys.path.insert(0, os.environ.get("FV_NOTEBOOK_DIR", os.getcwd()))
import fvnb

fvnb.setup()
print("smoke mode" if fvnb.SMOKE else "full mode")

# %% [markdown]
# ## Pricing parity with the contract fixtures

# %%
import json
from decimal import Decimal

from folioverse_ai.pricing import price_usage

cases = json.loads(
    (fvnb.ROOT / "packages/contracts/fixtures/pricing-cases.json").read_text(encoding="utf-8")
)["cases"]
failures = []
for c in cases:
    got = price_usage(c["prices"], c["usage"], c["reported"])
    exp = c["expected"]
    if (f"{got.amount:f}", got.status, got.reason) != (exp["amount"], exp["status"], exp["reason"]):
        failures.append(c["name"])
print(f"{len(cases) - len(failures)}/{len(cases)} pricing fixtures pass", failures or "")
assert not failures

PRICES = fvnb.demo_prices()
fvnb.table(
    [
        {
            "model": k,
            **{f: v[f] for f in ("inputPerMTok", "outputPerMTok", "cachedInputPerMTok")},
            "source": v["sourceUrl"],
        }
        for k, v in PRICES.items()
    ]
)

# %% [markdown]
# ## Measured usage vs context budget

# %%


async def build():
    svids = [
        await fvnb.ingest(
            (fvnb.DATA / "synthetic/docs/atlas-brief.pdf").read_bytes(), "atlas-brief.pdf", "application/pdf"
        )
    ]
    svids.append(
        await fvnb.ingest(
            (fvnb.DATA / "synthetic/books/small-lanterns.epub").read_bytes(),
            "small-lanterns.epub",
            "application/epub+zip",
        )
    )
    for d in fvnb.catalog()[: fvnb.sample(150, 20)]:
        svids.append(await fvnb.ingest(f"# {d['title']}\n\n{d['description']}", d["title"]))
    return svids


svids = fvnb.arun(build())
qa = fvnb.qa_small()
CONCISE = {
    **fvnb.MOCK_PLAN,
    "primary": {"modelConfigId": "mock-concise", "provider": "mock", "model": "folioverse-mock-concise"},
    "maxOutputTokens": 300,
}
BUDGETS = [300, 800, 1500, 3500] if not fvnb.SMOKE else [300, 3500]


async def measure(budget: int, plan: dict) -> list[dict]:
    out = []
    for q in qa:
        terminal, events = await fvnb.run_graph(
            "grounded_qa", svids, {"question": q["question"]}, {"contextBudget": budget}, plan
        )
        usage = [e["data"] for e in events if e["type"] == "usage.recorded"]
        answer = terminal["data"].get("answer", "")
        out.append(
            {
                "budget": budget,
                "model": plan["primary"]["modelConfigId"],
                "answerable": q["answerable"],
                "abstained": terminal["data"].get("outcome") == "ABSTAINED",
                "supported": bool(q.get("evidence")) and q["evidence"].lower() in answer.lower(),
                "input": sum(u["usage"]["input"] for u in usage),
                "output": sum(u["usage"]["output"] for u in usage),
            }
        )
    return out


runs = [r for b in BUDGETS for plan in (fvnb.MOCK_PLAN, CONCISE) for r in fvnb.arun(measure(b, plan))]


def cost(model: str, inp: int, out: int, cached: int = 0, discount: str | None = None) -> Decimal:
    p = dict(PRICES[model])
    if discount:
        p["batchDiscount"] = discount
    return price_usage(p, {"input": inp, "output": out, "cachedInput": cached}).amount


usage_rows = []
for b in BUDGETS:
    for model in PRICES:
        rows = [r for r in runs if r["budget"] == b and r["model"] == model]
        called = [r for r in rows if r["input"]]
        usage_rows.append(
            {
                "budget": b,
                "model": model,
                "input_mean": fvnb.mean(r["input"] for r in called),
                "output_mean": fvnb.mean(r["output"] for r in called),
                "demo_usd_per_1k_runs": float(fvnb.mean(cost(model, r["input"], r["output"]) for r in rows))
                * 1000,
                "answer_support": fvnb.mean(r["supported"] for r in rows if r["answerable"]),
                "abstain_rate": fvnb.mean(r["abstained"] for r in rows),
            }
        )
fvnb.table(usage_rows)

# %%
import matplotlib.pyplot as plt

fig, ax1 = plt.subplots(figsize=(6, 2.8))
g = [r for r in usage_rows if r["model"] == "mock-grounded"]
ax1.plot([r["budget"] for r in g], [r["input_mean"] for r in g], marker="o", label="input tokens / run")
ax1.set_xlabel("context budget (tokens)")
ax1.set_ylabel("input tokens / run")
ax2 = ax1.twinx()
ax2.plot(
    [r["budget"] for r in g],
    [r["answer_support"] for r in g],
    marker="s",
    color="tab:orange",
    label="answer support",
)
ax2.set_ylabel("answer support")
fig.legend(fontsize=8, loc="lower right")
fig.tight_layout()

# %% [markdown]
# ## Scenario projections (DEMO prices)
# Per-run token profile from the default budget (3500). Monthly spend = users × runs per user per day × 30.
# Caching assumes the stated share of input tokens is billed at the cached-input rate; the batch discount
# applies only to offline jobs (for example nightly evaluations), never to interactive chat.

# %%
ref = [r for r in runs if r["budget"] == BUDGETS[-1]]
profile = {
    m: {
        "input": fvnb.mean(r["input"] for r in ref if r["model"] == m and r["input"]),
        "output": fvnb.mean(r["output"] for r in ref if r["model"] == m and r["input"]),
        "abstain": fvnb.mean(r["abstained"] for r in ref if r["model"] == m),
    }
    for m in PRICES
}

scenarios = []
for users in (100, 1_000, 10_000):
    for model in PRICES:
        for cache in (0.0, 0.5, 0.9):
            pr = profile[model]
            per_call = cost(model, round(pr["input"]), round(pr["output"]), round(pr["input"] * cache))
            monthly_runs = users * 20 * 30
            billed_runs = monthly_runs * (1 - pr["abstain"])
            scenarios.append(
                {
                    "users": users,
                    "model": model,
                    "cache_share": cache,
                    "runs_per_month": monthly_runs,
                    "demo_usd_per_month": float(per_call) * billed_runs,
                }
            )
fvnb.table([s for s in scenarios if s["users"] == 1_000])

batch = [
    {
        "job": "nightly evaluation, 1k questions",
        "model": m,
        "standard": float(cost(m, round(profile[m]["input"]), round(profile[m]["output"]))) * 1000,
        "batch_50pct": float(cost(m, round(profile[m]["input"]), round(profile[m]["output"]), discount="0.5"))
        * 1000,
    }
    for m in PRICES
]
fvnb.table(batch)

# %% [markdown]
# ## Findings

# %%
lo, hi = (
    next(r for r in usage_rows if r["budget"] == b and r["model"] == "mock-grounded")
    for b in (BUDGETS[0], BUDGETS[-1])
)
fvnb.finding(
    f"Context budget {BUDGETS[0]} -> {BUDGETS[-1]} tokens: input/run {lo['input_mean']:.0f} -> {hi['input_mean']:.0f}, "
    f"answer support {lo['answer_support']:.0%} -> {hi['answer_support']:.0%}."
)
share_in = hi["input_mean"] * float(PRICES["mock-grounded"]["inputPerMTok"])
share_out = hi["output_mean"] * float(PRICES["mock-grounded"]["outputPerMTok"])
fvnb.finding(
    f"Input tokens are {share_in / (share_in + share_out):.0%} of mock-grounded spend at the default budget: context size is the main lever."
)
s0, s9 = (
    next(
        s
        for s in scenarios
        if s["users"] == 1_000 and s["model"] == "mock-grounded" and s["cache_share"] == c
    )
    for c in (0.0, 0.9)
)
fvnb.finding(
    f"Caching 90% of input saves {1 - s9['demo_usd_per_month'] / s0['demo_usd_per_month']:.0%} of the monthly DEMO spend for 1k users."
)
fvnb.finding(
    f"Abstention skips the model call for {profile['mock-grounded']['abstain']:.0%} of qa-small runs (billed as zero)."
)
fvnb.finding("All amounts use DEMO prices; they are illustrative only.")

# %%
fvnb.save(
    "07-cost-modeling",
    {
        "pricing": "DEMO prices from config/models/registry.seed.yaml (not provider prices)",
        "fixtures": {"total": len(cases), "failures": failures},
        "usageByBudget": usage_rows,
        "profile": profile,
        "scenarios": scenarios,
        "batch": batch,
    },
)
