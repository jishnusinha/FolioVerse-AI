"""Token pricing. Must agree with apps/api ledger pricing; both run fixtures/pricing-cases.json."""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

Q = Decimal("0.00000001")
MTOK = Decimal(1_000_000)


@dataclass(frozen=True)
class Priced:
    amount: Decimal
    status: str
    reason: str | None


def price_usage(prices: dict | None, usage: dict, reported: bool = True) -> Priced:
    if prices is None:
        return Priced(Decimal(0).quantize(Q), "FINAL_ESTIMATED", "PRICE_MISSING")
    inp = Decimal(str(prices["inputPerMTok"]))
    out = Decimal(str(prices["outputPerMTok"]))
    cp = Decimal(str(prices["cachedInputPerMTok"])) if prices.get("cachedInputPerMTok") is not None else inp
    rp = Decimal(str(prices["reasoningPerMTok"])) if prices.get("reasoningPerMTok") is not None else out
    disc = Decimal(str(prices.get("batchDiscount") or "0"))
    cached = int(usage.get("cachedInput", 0) or 0)
    reasoning = int(usage.get("reasoning", 0) or 0)
    if cached > usage["input"] or reasoning > usage["output"]:
        raise ValueError("token subsets exceed totals")
    total = (
        Decimal(usage["input"] - cached) * inp
        + Decimal(cached) * cp
        + Decimal(usage["output"] - reasoning) * out
        + Decimal(reasoning) * rp
    ) / MTOK
    total = (total * (Decimal(1) - disc)).quantize(Q, rounding=ROUND_HALF_UP)
    if not reported:
        return Priced(total, "FINAL_ESTIMATED", "USAGE_ESTIMATED")
    return Priced(total, "FINALIZED", None)
