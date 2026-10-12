"""Regenerates fixtures/pricing-cases.json.

Pricing rule (implemented independently in apps/api ledger and apps/ai-service ledger):
  prices are USD per 1M tokens (decimal strings); cachedInputPerMTok defaults to inputPerMTok,
  reasoningPerMTok defaults to outputPerMTok, batchDiscount defaults to 0.
  cachedInput is a subset of input; reasoning is a subset of output.
  amount = ((input - cached) * inP + cached * cP + (output - reasoning) * outP + reasoning * rP) / 1e6 * (1 - discount)
  rounded half-up to 8 decimal places.
  status: prices null -> FINAL_ESTIMATED (reason PRICE_MISSING, amount 0);
          usage not reported by provider -> FINAL_ESTIMATED (reason USAGE_ESTIMATED);
          otherwise FINALIZED.
Run: python packages/contracts/scripts/make_pricing_fixtures.py
"""

import json
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

Q = Decimal("0.00000001")


def price(case):
    p, u = case["prices"], case["usage"]
    if p is None:
        return Decimal(0), "FINAL_ESTIMATED", "PRICE_MISSING"
    inp = Decimal(p["inputPerMTok"])
    out = Decimal(p["outputPerMTok"])
    cp = Decimal(p["cachedInputPerMTok"]) if p.get("cachedInputPerMTok") is not None else inp
    rp = Decimal(p["reasoningPerMTok"]) if p.get("reasoningPerMTok") is not None else out
    disc = Decimal(p.get("batchDiscount") or "0")
    cached = u.get("cachedInput", 0)
    reasoning = u.get("reasoning", 0)
    total = (
        Decimal(u["input"] - cached) * inp
        + Decimal(cached) * cp
        + Decimal(u["output"] - reasoning) * out
        + Decimal(reasoning) * rp
    ) / Decimal(1_000_000)
    total = (total * (Decimal(1) - disc)).quantize(Q, rounding=ROUND_HALF_UP)
    if not case.get("reported", True):
        return total, "FINAL_ESTIMATED", "USAGE_ESTIMATED"
    return total, "FINALIZED", None


P_STD = {"inputPerMTok": "2.50", "outputPerMTok": "10.00", "cachedInputPerMTok": "1.25"}
P_MINI = {"inputPerMTok": "0.15", "outputPerMTok": "0.60", "cachedInputPerMTok": "0.075"}
P_REASON = {"inputPerMTok": "1.10", "outputPerMTok": "4.40", "cachedInputPerMTok": "0.275", "reasoningPerMTok": "4.40"}
P_REASON_SPLIT = {"inputPerMTok": "3.00", "outputPerMTok": "12.00", "reasoningPerMTok": "15.00"}
P_ZERO = {"inputPerMTok": "0", "outputPerMTok": "0"}
P_BATCH = {**P_STD, "batchDiscount": "0.5"}
P_ODD = {"inputPerMTok": "0.333333", "outputPerMTok": "1.777777"}

cases = [
    ("simple_input_output", P_STD, {"input": 1000, "output": 500}),
    ("zero_usage", P_STD, {"input": 0, "output": 0}),
    ("only_input", P_STD, {"input": 12345, "output": 0}),
    ("only_output", P_STD, {"input": 0, "output": 6789}),
    ("cached_subset", P_STD, {"input": 10000, "output": 200, "cachedInput": 8000}),
    ("all_cached", P_STD, {"input": 4096, "output": 10, "cachedInput": 4096}),
    ("cached_defaults_to_input_rate", {"inputPerMTok": "2.00", "outputPerMTok": "8.00"}, {"input": 5000, "output": 100, "cachedInput": 2500}),
    ("mini_model_small", P_MINI, {"input": 750, "output": 120}),
    ("mini_model_large", P_MINI, {"input": 950000, "output": 16000}),
    ("reasoning_same_rate", P_REASON, {"input": 3000, "output": 2000, "reasoning": 1500}),
    ("reasoning_split_rate", P_REASON_SPLIT, {"input": 3000, "output": 2000, "reasoning": 1500}),
    ("reasoning_all_output", P_REASON_SPLIT, {"input": 100, "output": 900, "reasoning": 900}),
    ("reasoning_and_cached", P_REASON, {"input": 20000, "output": 4000, "cachedInput": 15000, "reasoning": 3000}),
    ("zero_price_local_model", P_ZERO, {"input": 50000, "output": 5000}),
    ("batch_discount_half", P_BATCH, {"input": 100000, "output": 20000}),
    ("batch_discount_with_cache", P_BATCH, {"input": 100000, "output": 20000, "cachedInput": 50000}),
    ("odd_prices_rounding", P_ODD, {"input": 7, "output": 3}),
    ("odd_prices_rounding_large", P_ODD, {"input": 1234567, "output": 765432}),
    ("one_token_each", P_STD, {"input": 1, "output": 1}),
    ("half_up_boundary", {"inputPerMTok": "0.000005", "outputPerMTok": "0"}, {"input": 1, "output": 0}),
    ("million_input", P_STD, {"input": 1000000, "output": 0}),
    ("long_context", P_STD, {"input": 127000, "output": 4000, "cachedInput": 100000}),
    ("price_missing", None, {"input": 1000, "output": 1000}),
    ("usage_not_reported", P_STD, {"input": 1500, "output": 300}, False),
    ("usage_not_reported_cached", P_STD, {"input": 1500, "output": 300, "cachedInput": 1000}, False),
    ("price_missing_zero_usage", None, {"input": 0, "output": 0}),
]

out = []
for c in cases:
    name, prices, usage = c[0], c[1], c[2]
    reported = c[3] if len(c) > 3 else True
    case = {"name": name, "prices": prices, "usage": usage, "reported": reported}
    amount, status, reason = price(case)
    case["expected"] = {"amount": f"{amount:.8f}", "status": status, "reason": reason, "currency": "USD"}
    out.append(case)

path = Path(__file__).resolve().parent.parent / "fixtures" / "pricing-cases.json"
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps({"schemaVersion": 1, "cases": out}, indent=2) + "\n", encoding="utf-8")
print(f"wrote {len(out)} cases to {path}")
