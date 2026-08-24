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

    Model name confirmed directly from a real API error message during
    testing (2026-08-24): the API itself reported "gemini-2.5-flash is no
    longer available... use models/gemini-3.6-flash" — this is the most
    reliable source available (ground truth from the provider, not a doc
    page that might be stale). Check https://ai.google.dev/gemini-api/docs/models
    for anything newer before the deadline."""

    def __init__(self, api_key: str, model: str):
        from google import genai

        self._client = genai.Client(api_key=api_key)
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
    `openai` package pointed at OpenRouter's base URL.

    Uses "openrouter/free" — OpenRouter's own auto-router that always
    selects from whatever free models are currently available — instead
    of a pinned model slug. OpenRouter's free-tier lineup was found to
    rotate very frequently (weekly, per their own model listing), so
    pinning a specific ":free" slug (as an earlier version of this file
    did) breaks often; the auto-router is the future-proof choice here."""

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
    gemini_models: tuple[str, str] = ("gemini-3.6-flash", "gemini-3.6-flash-lite"),
    groq_models: tuple[str, str] = ("openai/gpt-oss-120b", "openai/gpt-oss-20b"),
    openrouter_models: tuple[str, str] = ("openrouter/free", "openrouter/free"),
) -> FallbackLLMClient:
    """Wires up the 6-model fallback chain: 2 Gemini -> 2 Groq -> 2
    OpenRouter, in that order. Any API key left as None skips that
    provider's 2 models entirely (e.g. if you only have a Groq key,
    pass only groq_api_key and you get a 2-model chain, not 6).

    Model names last verified 2026-08-24 against real API testing:
    - gemini-3.6-flash: confirmed via a real API error message (Google's
      own deprecation notice for gemini-2.5-flash/2.0-flash)
    - gemini-3.6-flash-lite: EDUCATED GUESS following Google's typical
      flash/flash-lite naming pattern, NOT independently confirmed —
      verify this one specifically before relying on it
    - openai/gpt-oss-120b, openai/gpt-oss-20b: confirmed via Groq's
      official deprecation page (console.groq.com/docs/deprecations)
    - openrouter/free (used for both OpenRouter slots): OpenRouter's own
      auto-router, chosen because their free-tier named models were
      found to rotate weekly — pinning a specific slug broke almost
      immediately in real testing. Each call may land on a different
      underlying free model, which is fine for fallback purposes.

    VERIFY gemini-3.6-flash-lite specifically before a demo — everything
    else above has direct evidence behind it."""
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
