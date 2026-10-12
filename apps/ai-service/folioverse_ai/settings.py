from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment configuration. Secret values are never logged or echoed in errors."""

    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    role: Literal["api", "ingest", "all"] = Field("all", alias="ROLE")
    env: str = Field("development", alias="NODE_ENV")
    database_url: str | None = Field(None, alias="DATABASE_URL")
    qdrant_url: str = Field(":memory:", alias="QDRANT_URL")
    qdrant_collection: str = Field("fv_chunks_v1", alias="FV_QDRANT_COLLECTION")
    internal_public_key: str = Field("", alias="FV_INTERNAL_JWT_PUBLIC_KEY")
    embedder: Literal["hash", "fastembed"] = Field("hash", alias="FV_EMBEDDER")
    dense_model: str = Field("BAAI/bge-small-en-v1.5", alias="FV_DENSE_MODEL")
    sparse_model: str = Field("Qdrant/bm25", alias="FV_SPARSE_MODEL")
    rerank: bool = Field(False, alias="FV_RERANK")
    rerank_model: str = Field("Xenova/ms-marco-MiniLM-L-6-v2", alias="FV_RERANK_MODEL")
    openai_api_key: str | None = Field(None, alias="OPENAI_API_KEY")
    openai_base_url: str | None = Field(None, alias="OPENAI_BASE_URL")
    ollama_url: str | None = Field(None, alias="FV_OLLAMA_URL")
    checkpointer: Literal["memory", "postgres"] = Field("memory", alias="FV_CHECKPOINTER")
    context_budget_tokens: int = Field(3500, alias="FV_CONTEXT_BUDGET_TOKENS")
    top_k: int = Field(6, alias="FV_TOP_K")
    max_download_mb: int = Field(200, alias="FV_MAX_DOWNLOAD_MB")
    lab_faults: bool = Field(False, alias="FV_LAB_FAULTS")
    mock_token_delay_ms: int = Field(8, alias="FV_MOCK_TOKEN_DELAY_MS")
    otel_endpoint: str | None = Field(None, alias="OTEL_EXPORTER_OTLP_ENDPOINT")
    log_level: str = Field("info", alias="LOG_LEVEL")

    @property
    def public_key_pem(self) -> str:
        return self.internal_public_key.replace("\\n", "\n")


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
