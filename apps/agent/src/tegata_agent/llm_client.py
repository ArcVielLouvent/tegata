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
    """Requires the `google-generativeai` package and a Gemini API key.
    Check https://ai.google.dev/gemini-api/docs/models for current model
    names before the deadline — these change over time and the ones below
    may not be current by the time you read this."""

    def __init__(self, api_key: str, model: str):
        import google.generativeai as genai

        genai.configure(api_key=api_key)
        self._model = genai.GenerativeModel(model)

    def complete(self, system_prompt: str, user_message: str) -> str:
        model_with_system = self._model
        response = model_with_system.generate_content(
            [{"role": "user", "parts": [f"{system_prompt}\n\n{user_message}"]}]
        )
        return response.text


class GroqLLMClient:
    """Requires the `groq` package and a Groq API key. Check
    https://console.groq.com/docs/models for current model names."""

    def __init__(self, api_key: str, model: str, max_tokens: int = 1024):
        from groq import Groq

        self._client = Groq(api_key=api_key)
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
    `openai` package pointed at OpenRouter's base URL. Check
    https://openrouter.ai/models for current free-tier model names
    (they typically have a ':free' suffix)."""

    def __init__(self, api_key: str, model: str, max_tokens: int = 1024):
        from openai import OpenAI

        self._client = OpenAI(api_key=api_key, base_url="https://openrouter.ai/api/v1")
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
    gemini_models: tuple[str, str] = ("gemini-2.5-flash", "gemini-2.0-flash"),
    groq_models: tuple[str, str] = ("llama-3.3-70b-versatile", "llama-3.1-8b-instant"),
    openrouter_models: tuple[str, str] = (
        "meta-llama/llama-3.1-8b-instruct:free",
        "google/gemini-flash-1.5:free",
    ),
) -> FallbackLLMClient:
    """Wires up the 6-model fallback chain: 2 Gemini -> 2 Groq -> 2
    OpenRouter, in that order. Any API key left as None skips that
    provider's 2 models entirely (e.g. if you only have a Groq key,
    pass only groq_api_key and you get a 2-model chain, not 6).

    VERIFY THE MODEL NAMES ABOVE before relying on this for a demo —
    provider free-tier model lineups change; check each provider's docs
    linked in the client classes above."""
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
