"""The plan's budget guard stops grounded_qa before the model call when the real prompt could overspend."""

from conftest import MOCK_PLAN
from corpus import MARKET
from helpers import ingest, of_type, run

WS = "0190f0f0-0000-7000-8000-0000000000d4"
QUESTION = {"question": "What annual growth does the base case project through 2030?"}
PRICES = {"inputPerMTok": "2.00", "outputPerMTok": "8.00"}


async def test_stops_before_the_model_when_the_prompt_exceeds_the_guard(repo):
    svid = await ingest(MARKET, WS, "Market Outlook")
    plan = {**MOCK_PLAN, "budgetGuard": {"maxCost": "0.00000100", "prices": PRICES}}
    term, events, _ = await run("grounded_qa", WS, [svid], QUESTION, plan=plan)
    assert term["data"]["status"] == "BUDGET_REJECTED", term
    assert term["data"]["outcome"] == "ABSTAINED"
    assert "Nothing was charged" in term["data"]["answer"]
    assert not of_type(events, "usage.recorded")
    assert not of_type(events, "token.delta")
    nodes = [e["data"]["node"] for e in of_type(events, "node.finished")]
    assert nodes == ["retrieve", "budget_stop", "finalize"]


async def test_answers_when_the_guard_leaves_room(repo):
    svid = await ingest(MARKET, WS, "Market Outlook")
    plan = {**MOCK_PLAN, "budgetGuard": {"maxCost": "1.00000000", "prices": PRICES}}
    term, events, _ = await run("grounded_qa", WS, [svid], QUESTION, plan=plan)
    assert term["data"]["status"] == "SUCCEEDED"
    assert term["data"]["outcome"] == "ANSWERED"
    assert len(of_type(events, "usage.recorded")) == 1
