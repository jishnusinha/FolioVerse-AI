# syntax=docker/dockerfile:1.7
# FastAPI AI service (ROLE=api|ingest). CPU-only: fastembed uses onnxruntime, no torch.
# Non-root, runs on a read-only root filesystem (writable /tmp only); models are baked in.
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.4.30 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/venv
WORKDIR /repo
COPY pyproject.toml uv.lock ./
COPY apps/ai-service/pyproject.toml apps/ai-service/
COPY packages/folioverse-ml packages/folioverse-ml
COPY apps/ai-service/folioverse_ai apps/ai-service/folioverse_ai
# --no-editable installs folioverse-ai and folioverse-ml into /venv as wheels; the default editable install
# only links back to /repo, which does not exist in the runtime stage.
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-editable --package folioverse-ai

FROM python:3.12-slim AS models
COPY --from=build /venv /venv
ENV PATH=/venv/bin:$PATH FASTEMBED_CACHE_PATH=/models
# Pre-download embedding models so containers start offline.
# huggingface_hub writes some cache metadata as 0600 root; the runtime user (10001) must be able to read all of it.
RUN python -c "from fastembed import TextEmbedding, SparseTextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5'); SparseTextEmbedding('Qdrant/bm25')" \
  && chmod -R a+rX /models

FROM python:3.12-slim AS runtime
RUN useradd --create-home --uid 10001 app && pip uninstall -y pip setuptools wheel 2>/dev/null || true
COPY --from=build /venv /venv
COPY --from=models /models /models
# DEMO discovery catalog and training interactions; the recommender trains its artifact on first use.
COPY datasets/synthetic/catalog /data/catalog
COPY datasets/evaluation/rec-holdout /data/rec-holdout
# HF_HUB_OFFLINE makes fastembed read the baked cache without lock files, so /models can stay read-only.
ENV PATH=/venv/bin:$PATH FASTEMBED_CACHE_PATH=/models HF_HUB_OFFLINE=1 HF_HOME=/tmp/hf \
    PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 FV_EMBEDDER=fastembed \
    FV_REC_CATALOG=/data/catalog/catalog.jsonl FV_REC_HOLDOUT=/data/rec-holdout FV_REC_ARTIFACT_DIR=/tmp/rec-artifacts
WORKDIR /app
# Isolated mode (-I) ignores the working directory and PYTHONPATH, so this fails unless the packages are in /venv.
RUN python -I -c "import folioverse_ai.serve, folioverse_ml"
USER 10001:10001
EXPOSE 8000 8001
HEALTHCHECK --interval=15s --timeout=4s --start-period=60s --retries=3 \
  CMD ["python", "-c", "import os,sys,urllib.request as u; sys.exit(0 if u.urlopen(f\"http://127.0.0.1:{os.environ.get('PORT','8000')}/healthz\", timeout=3).status == 200 else 1)"]
CMD ["python", "-m", "folioverse_ai.serve"]
