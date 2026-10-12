# syntax=docker/dockerfile:1.7
# FastAPI AI service (ROLE=api|ingest). CPU-only: fastembed uses onnxruntime, no torch.
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.4.30 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/venv
WORKDIR /repo
COPY pyproject.toml uv.lock ./
COPY apps/ai-service/pyproject.toml apps/ai-service/
COPY packages/folioverse-ml packages/folioverse-ml
COPY apps/ai-service/folioverse_ai apps/ai-service/folioverse_ai
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --package folioverse-ai

FROM python:3.12-slim AS models
COPY --from=build /venv /venv
ENV PATH=/venv/bin:$PATH FASTEMBED_CACHE_PATH=/models
# Pre-download embedding models so containers start offline.
RUN python -c "from fastembed import TextEmbedding, SparseTextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5'); SparseTextEmbedding('Qdrant/bm25')"

FROM python:3.12-slim AS runtime
RUN useradd --create-home --uid 10001 app
COPY --from=build /venv /venv
COPY --from=models --chown=app:app /models /models
ENV PATH=/venv/bin:$PATH FASTEMBED_CACHE_PATH=/models PYTHONUNBUFFERED=1 FV_EMBEDDER=fastembed
WORKDIR /app
USER app
EXPOSE 8000 8001
CMD ["python", "-m", "folioverse_ai.serve", "--port", "8000"]
