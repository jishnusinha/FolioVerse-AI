"""Chat model providers. The plan (resolved by the API) decides which ones may be used."""

import asyncio
import json
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

import httpx

from .settings import get_settings
from .text import count_tokens

OnToken = Callable[[str], Awaitable[None]] | None


class ProviderError(Exception):
    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind  # TIMEOUT | RATE_LIMIT | PROVIDER | AUTH | UNAVAILABLE


@dataclass
class ChatResult:
    text: str
    usage: dict = field(default_factory=dict)
    reported: bool = True
    latency_ms: float = 0.0


def _messages_tokens(messages: list[dict]) -> int:
    return sum(count_tokens(m["content"]) + 4 for m in messages)


_FIRST_CITED = re.compile(r"^(.*?)\s*(\[S\d+\])", re.S)


def concise(text: str) -> str:
    """The `*-concise` mock variant keeps the main clause of the first cited sentence (a terser contestant)."""
    if text.lstrip().startswith(("{", "[")):
        return text
    m = _FIRST_CITED.match(text)
    if not m:
        return text[:160]
    body = m.group(1).split(", ")[0].rstrip(" .")
    return f"{body} {m.group(2)}."


class MockProvider:
    """Deterministic provider for demos and CI. Output is the graph's extractive draft (`mock_text`).

    Every run that uses it is flagged is_demo and labelled SIMULATED in the UI.
    """

    name = "mock"

    async def complete(
        self,
        messages,
        model,
        max_tokens,
        temperature,
        on_token: OnToken,
        *,
        mock_text: str,
        inject: str | None = None,
        json_mode=False,
    ):
        started = time.perf_counter()
        if inject == "provider_timeout":
            await asyncio.sleep(0.05)
            raise ProviderError("TIMEOUT", "Mock provider timed out (injected)")
        if inject == "provider_429":
            raise ProviderError("RATE_LIMIT", "Mock provider rate limited (injected)")
        text = concise(mock_text) if str(model).endswith("-concise") else mock_text
        if inject == "malformed_output":
            text = '{"items": [ {"broken": tru' if json_mode else text[: max(1, len(text) // 3)] + " [S99]"
        words = text.split(" ")
        limit = max_tokens * 4
        out = ""
        delay = get_settings().mock_token_delay_ms / 1000
        for i, w in enumerate(words):
            piece = w if i == 0 else " " + w
            if len(out) + len(piece) > limit:
                break
            out += piece
            if on_token:
                await on_token(piece)
                if delay:
                    await asyncio.sleep(delay)
        usage = {
            "input": _messages_tokens(messages),
            "output": count_tokens(out),
            "cachedInput": 0,
            "reasoning": 0,
        }
        return ChatResult(out, usage, True, (time.perf_counter() - started) * 1000)


class OpenAIProvider:
    name = "openai"

    async def complete(
        self,
        messages,
        model,
        max_tokens,
        temperature,
        on_token: OnToken,
        *,
        mock_text: str = "",
        inject=None,
        json_mode=False,
    ):
        s = get_settings()
        if not s.openai_api_key:
            raise ProviderError("UNAVAILABLE", "OpenAI is not configured")
        import openai
        from langchain_openai import ChatOpenAI

        kwargs = {"response_format": {"type": "json_object"}} if json_mode else {}
        llm = ChatOpenAI(
            model=model,
            api_key=s.openai_api_key,
            base_url=s.openai_base_url,
            max_tokens=max_tokens,
            temperature=temperature,
            timeout=90,
            max_retries=1,
            stream_usage=True,
            model_kwargs=kwargs,
        )
        started = time.perf_counter()
        text, usage_md = "", None
        try:
            async for chunk in llm.astream([(m["role"], m["content"]) for m in messages]):
                piece = chunk.content if isinstance(chunk.content, str) else ""
                if piece:
                    text += piece
                    if on_token:
                        await on_token(piece)
                if getattr(chunk, "usage_metadata", None):
                    usage_md = chunk.usage_metadata
        except openai.RateLimitError as e:
            raise ProviderError("RATE_LIMIT", "Provider rate limit") from e
        except openai.APITimeoutError as e:
            raise ProviderError("TIMEOUT", "Provider timeout") from e
        except openai.AuthenticationError as e:
            raise ProviderError("AUTH", "Provider rejected credentials") from e
        except openai.APIError as e:
            raise ProviderError("PROVIDER", f"Provider error {e.__class__.__name__}") from e
        if usage_md:
            details_in = usage_md.get("input_token_details") or {}
            details_out = usage_md.get("output_token_details") or {}
            usage = {
                "input": int(usage_md.get("input_tokens", 0)),
                "output": int(usage_md.get("output_tokens", 0)),
                "cachedInput": int(details_in.get("cache_read", 0) or 0),
                "reasoning": int(details_out.get("reasoning", 0) or 0),
            }
            reported = True
        else:
            usage = {
                "input": _messages_tokens(messages),
                "output": count_tokens(text),
                "cachedInput": 0,
                "reasoning": 0,
            }
            reported = False
        return ChatResult(text, usage, reported, (time.perf_counter() - started) * 1000)


class OllamaProvider:
    name = "ollama"

    async def complete(
        self,
        messages,
        model,
        max_tokens,
        temperature,
        on_token: OnToken,
        *,
        mock_text: str = "",
        inject=None,
        json_mode=False,
    ):
        s = get_settings()
        if not s.ollama_url:
            raise ProviderError("UNAVAILABLE", "Ollama is not configured")
        started = time.perf_counter()
        body = {
            "model": model,
            "messages": messages,
            "stream": True,
            "options": {"num_predict": max_tokens, "temperature": temperature},
        }
        if json_mode:
            body["format"] = "json"
        text, usage = "", None
        try:
            async with (
                httpx.AsyncClient(timeout=180) as client,
                client.stream("POST", f"{s.ollama_url}/api/chat", json=body) as r,
            ):
                r.raise_for_status()
                async for line in r.aiter_lines():
                    if not line:
                        continue
                    ev = json.loads(line)
                    piece = (ev.get("message") or {}).get("content", "")
                    if piece:
                        text += piece
                        if on_token:
                            await on_token(piece)
                    if ev.get("done"):
                        usage = {
                            "input": ev.get("prompt_eval_count", 0),
                            "output": ev.get("eval_count", 0),
                            "cachedInput": 0,
                            "reasoning": 0,
                        }
        except httpx.TimeoutException as e:
            raise ProviderError("TIMEOUT", "Local model timeout") from e
        except httpx.HTTPError as e:
            raise ProviderError("PROVIDER", f"Local model error {e.__class__.__name__}") from e
        reported = usage is not None
        usage = usage or {
            "input": _messages_tokens(messages),
            "output": count_tokens(text),
            "cachedInput": 0,
            "reasoning": 0,
        }
        return ChatResult(text, usage, reported, (time.perf_counter() - started) * 1000)


PROVIDERS = {"mock": MockProvider(), "openai": OpenAIProvider(), "ollama": OllamaProvider()}


def available_providers() -> list[str]:
    s = get_settings()
    out = ["mock"]
    if s.openai_api_key:
        out.append("openai")
    if s.ollama_url:
        out.append("ollama")
    return out
