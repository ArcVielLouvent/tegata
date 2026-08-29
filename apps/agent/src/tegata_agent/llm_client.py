"""
LLM client abstraction.

Defined as a small protocol so nlu_frontdoor.py's two-pass logic can be
tested completely offline with a fake implementation (see
tests/test_nlu_frontdoor.py) — no API key or network call needed for
unit tests. AnthropicLLMClient is the real implementation used in
production/verification scripts.
"""
from __future__ import annotations

from typing import Protocol


class LLMClient(Protocol):
    def complete(self, system_prompt: str, user_message: str) -> str:
        """Returns the model's raw text response."""
        ...


class AllProvidersFailedError(Exception):
    """Raised when every LLM in a FallbackLLMClient's chain failed."""

    def __init__(self, errors: list[tuple[str, Exception]]):
        summary = "; ".join(f"{name}: {err}" for name, err in errors)
        super().__init__(f"All {len(errors)} LLM providers failed: {summary}")
        self.errors = errors


class FallbackLLMClient:
    """Tries a list of (name, LLMClient) pairs in order, returning the
    first successful response. Falls through to the next on any
    exception (rate limit, timeout, API error, etc.) — this is what makes
    the demo resilient to any single provider having a bad moment during
    judging, without needing a real production-grade retry/circuit-breaker
    setup we don't have time to build properly this week.

    Sequential, not parallel — racing all 6 models simultaneously would
    add real complexity (cancellation, cost of wasted calls, non-determinism
    in tests) for marginal benefit over "try the good ones first, fall
    back only on failure." If there's time left over after core phases
    are done, parallel racing is a reasonable stretch addition.
    """

    def __init__(self, providers: list[tuple[str, LLMClient]]):
        if not providers:
            raise ValueError("FallbackLLMClient needs at least one provider")
        self._providers = providers

    def complete(self, system_prompt: str, user_message: str) -> str:
        errors: list[tuple[str, Exception]] = []
        for name, client in self._providers:
            try:
                return client.complete(system_prompt, user_message)
            except Exception as e:  # noqa: BLE001 - deliberately broad: any provider failure falls through
                errors.append((name, e))
        raise AllProvidersFailedError(errors)


class GeminiLLMClient:
    """Requires the `google-genai` package (NOT the deprecated
    `google-generativeai` package, which stopped receiving updates — see
    https://github.com/google-gemini/deprecated-generative-ai-python) and
    a Gemini API key.

    Model names confirmed via a real web search of ai.google.dev,
    2026-08-29 (both GA/stable as of that date) — gemini-3.6-flash-lite,
    used here previously, was an educated guess that turned out wrong
    (confirmed 404 NOT_FOUND in real testing against the TS port of this
    same client, apps/web/lib/llmClient.ts). Google's Flash line moves
    fast (3.6 -> 3.7 shipped three weeks apart per Google's own
    announcement) — recheck https://ai.google.dev/gemini-api/docs/models
    before trusting these past the hackathon deadline.

    UNVERIFIED: the `http_options={"timeout": ...}` constructor kwarg is
    documented for the current google-genai SDK, but hasn't actually been
    run in this project (the TS port test-verified its own AbortController
    timeout in real testing instead — this Python client is a secondary
    reference implementation, not what apps/web actually calls). Confirm
    against your installed google-genai version before relying on it."""

    def __init__(self, api_key: str, model: str, timeout_seconds: float = 15.0):
        from google import genai

        self._client = genai.Client(
            api_key=api_key, http_options={"timeout": timeout_seconds * 1000}
        )
        self._model = model

    def complete(self, system_prompt: str, user_message: str) -> str:
        response = self._client.models.generate_content(
            model=self._model,
            contents=f"{system_prompt}\n\n{user_message}",
        )
        return response.text


class GroqLLMClient:
    """Requires the `groq` package and a Groq API key.

    Model names confirmed via Groq's official deprecation announcement
    (console.groq.com/docs/deprecations, 2026-06-17): llama-3.3-70b-versatile
    and llama-3.1-8b-instant were deprecated; official recommended
    replacements are openai/gpt-oss-120b and openai/gpt-oss-20b. Check
    that page again before the deadline in case of further changes."""

    def __init__(
        self, api_key: str, model: str, max_tokens: int = 1024, timeout_seconds: float = 15.0
    ):
        from groq import Groq

        self._client = Groq(api_key=api_key, timeout=timeout_seconds)
        self._model = model
        self._max_tokens = max_tokens

    def complete(self, system_prompt: str, user_message: str) -> str:
        response = self._client.chat.completions.create(
            model=self._model,
            max_tokens=self._max_tokens,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
        )
        return response.choices[0].message.content


class OpenRouterLLMClient:
    """OpenRouter exposes an OpenAI-compatible API, so this uses the
    `openai` package pointed at OpenRouter's base URL.

    Uses two SPECIFIC free Nvidia Nemotron models
    (nvidia/nemotron-3-ultra-550b-a55b:free,
    nvidia/nemotron-3.5-lightning:free) instead of the "openrouter/free"
    auto-router used previously. Switched 2026-08-29 after the
    auto-router hit a real 429 in testing ("z-ai/glm-5.2:free is
    temporarily rate-limited upstream") — the auto-router can land on
    whichever underlying free model is least overloaded at that moment,
    which isn't necessarily anything with its own separate rate-limit
    pool. Pinning to two specific named free models is a reasonable
    inference that each has its own pool rather than sharing one across
    every OpenRouter free-tier user regardless of which model they get
    routed to — NOT independently confirmed how OpenRouter scopes
    free-tier limits internally. Slugs confirmed via OpenRouter's own
    model pages (openrouter.ai/nvidia), 2026-08-29."""

    def __init__(
        self, api_key: str, model: str, max_tokens: int = 1024, timeout_seconds: float = 15.0
    ):
        from openai import OpenAI

        self._client = OpenAI(
            api_key=api_key, base_url="https://openrouter.ai/api/v1", timeout=timeout_seconds
        )
        self._model = model
        self._max_tokens = max_tokens

    def complete(self, system_prompt: str, user_message: str) -> str:
        response = self._client.chat.completions.create(
            model=self._model,
            max_tokens=self._max_tokens,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
        )
        return response.choices[0].message.content


def build_default_fallback_client(
    gemini_api_key: str | None = None,
    groq_api_key: str | None = None,
    openrouter_api_key: str | None = None,
    gemini_models: tuple[str, str] = ("gemini-3.7-flash", "gemini-3.5-flash-lite"),
    groq_models: tuple[str, str] = ("openai/gpt-oss-120b", "openai/gpt-oss-20b"),
    openrouter_models: tuple[str, str] = (
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        "nvidia/nemotron-3.5-lightning:free",
    ),
) -> FallbackLLMClient:
    """Wires up the 6-model fallback chain: 2 Gemini -> 2 Groq -> 2
    OpenRouter, in that order. Any API key left as None skips that
    provider's 2 models entirely (e.g. if you only have a Groq key,
    pass only groq_api_key and you get a 2-model chain, not 6).

    Model names last verified 2026-08-29 against real testing (via the
    TS port, apps/web/lib/llmClient.ts — this Python client is the
    secondary reference implementation):
    - gemini-3.7-flash, gemini-3.5-flash-lite: confirmed real GA model
      IDs via web search of ai.google.dev. The previous
      gemini-3.6-flash-lite guess 404'd in real testing.
    - openai/gpt-oss-120b, openai/gpt-oss-20b: confirmed via Groq's
      official deprecation page (console.groq.com/docs/deprecations)
    - nvidia/nemotron-3-ultra-550b-a55b:free,
      nvidia/nemotron-3.5-lightning:free: confirmed real slugs via
      OpenRouter's own model pages. Replaces "openrouter/free" (the
      auto-router), which hit a real 429 in testing.

    Recheck each provider's docs before a demo — this whole area moves
    fast and every model name here has already been wrong once."""
    providers: list[tuple[str, LLMClient]] = []

    if gemini_api_key:
        for model in gemini_models:
            providers.append((f"gemini:{model}", GeminiLLMClient(gemini_api_key, model)))
    if groq_api_key:
        for model in groq_models:
            providers.append((f"groq:{model}", GroqLLMClient(groq_api_key, model)))
    if openrouter_api_key:
        for model in openrouter_models:
            providers.append(
                (f"openrouter:{model}", OpenRouterLLMClient(openrouter_api_key, model))
            )

    return FallbackLLMClient(providers)
    """Real implementation using the Anthropic API.

    Requires the `anthropic` package and an ANTHROPIC_API_KEY environment
    variable (or pass api_key directly).
    """

    def __init__(self, api_key: str, model: str = "claude-sonnet-5", max_tokens: int = 1024):
        """model defaults to Claude Sonnet 5 (current mainline model as of
        this build). Check https://docs.claude.com for the latest
        available model names before the hackathon deadline, in case
        something newer has shipped."""
        import anthropic

        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model
        self._max_tokens = max_tokens

    def complete(self, system_prompt: str, user_message: str) -> str:
        response = self._client.messages.create(
            model=self._model,
            max_tokens=self._max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
        )
        return "".join(block.text for block in response.content if hasattr(block, "text"))
