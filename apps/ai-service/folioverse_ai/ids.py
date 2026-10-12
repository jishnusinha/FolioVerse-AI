import os
import time
import uuid

_NS = uuid.UUID("6f1c3c8e-1f0b-4f7a-9d55-6a1e1b9b0f11")


def uuid7() -> str:
    """RFC 9562 UUIDv7: 48-bit unix ms timestamp, version/variant bits, random tail."""
    ms = int(time.time() * 1000)
    rand = int.from_bytes(os.urandom(10), "big")
    value = (ms & ((1 << 48) - 1)) << 80
    value |= 0x7 << 76
    value |= ((rand >> 68) & 0xFFF) << 64
    value |= 0x2 << 62
    value |= rand & ((1 << 62) - 1)
    return str(uuid.UUID(int=value))


def stable_id(*parts: object) -> str:
    """Deterministic UUID for derived artifacts (chunks, points) so re-ingestion overwrites."""
    return str(uuid.uuid5(_NS, "|".join(str(p) for p in parts)))
