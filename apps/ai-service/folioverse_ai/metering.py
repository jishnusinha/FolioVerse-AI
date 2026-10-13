"""Local compute metering: embedding and rerank time becomes LOCAL_COMPUTE usage.

The amount is wall time of the compute call on the service's CPU, priced by the admin-entered `local-compute`
CPU-hour rate (zero and FINAL_ESTIMATED until one exists). It is reported apart from AI API spend.
"""

import logging

from .repo import get_repo

log = logging.getLogger(__name__)


async def meter_local(
    workspace_id: str,
    seconds: float,
    model: str,
    feature: str,
    run_id: str | None = None,
    user_id: str | None = None,
) -> None:
    if seconds <= 0:
        return
    try:
        await get_repo().insert_usage_event(
            {
                "workspace_id": workspace_id,
                "run_id": run_id,
                "user_id": user_id,
                "cost_class": "LOCAL_COMPUTE",
                "provider": "local",
                "model": model,
                "model_config_id": "local-compute",
                "compute_seconds": round(seconds, 6),
                "reported": True,
                "feature": feature,
            }
        )
    except Exception as e:  # noqa: BLE001 - metering must never fail the caller
        log.warning("local compute metering failed: %s", type(e).__name__)
