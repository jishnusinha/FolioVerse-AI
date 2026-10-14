"""Ingestion work unit: download -> parse -> chunk -> embed -> index -> persist."""

import asyncio
import time

import httpx

from ..events import Emitter
from ..metering import meter_local
from ..repo import get_repo
from ..retrieval.embedder import get_embedder
from ..retrieval.store import get_store
from ..settings import get_settings
from .chunking import chunk_document
from .parsers import ParseError, parse


async def download(url: str, max_bytes: int) -> bytes:
    async with httpx.AsyncClient(timeout=120) as client, client.stream("GET", url) as r:
        r.raise_for_status()
        buf = bytearray()
        async for part in r.aiter_bytes():
            buf.extend(part)
            if len(buf) > max_bytes:
                raise ParseError("File exceeds the ingestion size limit")
        return bytes(buf)


async def run_ingestion(req: dict, emitter: Emitter, data: bytes | None = None) -> dict:
    """Executes one ingestion unit and emits ingestion.stage / ingestion.finished events.

    Returns the final stats. Permanent problems (unparseable, empty) yield FAILED without raising;
    infrastructure errors raise so the API worker can retry with backoff.
    """
    s = get_settings()
    svid, wid = req["sourceVersionId"], req["workspaceId"]
    started = time.perf_counter()

    async def stage(state: str, progress: float, message: str | None = None):
        await emitter.emit(
            "ingestion.stage",
            {
                "sourceVersionId": svid,
                "sourceId": req.get("sourceId"),
                "jobId": req.get("jobId"),
                "state": state,
                "progress": progress,
                "message": message,
            },
        )

    async def finish(state: str, stats: dict, error: str | None = None):
        await emitter.emit(
            "ingestion.finished",
            {"sourceVersionId": svid, "state": state, "stats": stats, **({"error": error} if error else {})},
        )
        return {"state": state, **stats}

    await stage("PARSING", 0.25)
    if data is None:
        data = await download(req["objectUrl"], s.max_download_mb * 1024 * 1024)
    try:
        doc = await asyncio.to_thread(parse, data, req["mimeType"])
    except ParseError as e:
        return await finish("QUARANTINED", {}, str(e))
    except UnicodeDecodeError:
        return await finish("QUARANTINED", {}, "Text is not valid UTF-8")

    if not any(e.text.strip() for e in doc.elements):
        return await finish(
            "FAILED",
            {"pages": len(doc.pages)},
            "No extractable text (scanned documents require OCR; OCR fallback found no text)",
        )

    await stage("INDEXING", 0.5, f"{len(doc.pages)} pages parsed")
    chunks = chunk_document(doc, svid)
    children = [c for c in chunks if c["level"] == "CHILD"]
    embedder = get_embedder()
    store = get_store()
    texts = [c["text"] for c in children]
    t0 = time.perf_counter()
    dense = await asyncio.to_thread(embedder.embed_documents, texts)
    embed_seconds = time.perf_counter() - t0
    await stage("INDEXING", 0.75, f"{len(children)} passages embedded")
    t0 = time.perf_counter()
    sparse = await asyncio.to_thread(embedder.sparse_documents, texts)
    embed_seconds += time.perf_counter() - t0
    store.ensure(embedder.dims)
    await asyncio.to_thread(store.delete_versions, wid, [svid])
    payloads = [
        {
            "workspace_id": wid,
            "source_version_id": svid,
            "source_id": req.get("sourceId"),
            "project_id": req.get("projectId"),
            "chunk_id": c["id"],
            "parent_id": c["parent_id"],
            "page": c["page_start"],
            "page_end": c["page_end"],
            "title": req.get("title"),
        }
        for c in children
    ]
    await asyncio.to_thread(store.upsert, [c["id"] for c in children], dense, sparse, payloads)
    await stage("INDEXING", 0.9, "vectors stored")

    manifest = {
        "collection": store.collection,
        "embedder": embedder.name,
        "dims": embedder.dims,
        "parent_count": len(chunks) - len(children),
        "child_count": len(children),
    }
    pages = [{"page_no": p.page_no, "text": p.text, "width": p.width, "height": p.height} for p in doc.pages]
    await get_repo().replace_version(wid, svid, pages, chunks, manifest)

    stats = {
        "pages": len(doc.pages),
        "elements": len(doc.elements),
        "parentChunks": manifest["parent_count"],
        "childChunks": manifest["child_count"],
        "failedPages": doc.failed_pages,
        "embedder": embedder.name,
        "collection": store.collection,
        "seconds": round(time.perf_counter() - started, 3),
        "embedSeconds": round(embed_seconds, 3),
    }
    if doc.metadata:
        stats["metadata"] = doc.metadata
    if doc.chapters:
        stats["chapters"] = doc.chapters[:1000]
    state = "PARTIAL" if doc.failed_pages else "READY"
    await meter_local(wid, embed_seconds, embedder.name, "ingestion")
    return await finish(state, stats)
