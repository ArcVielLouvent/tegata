import pytest

from tegata_agent.llm_client import (
    AllProvidersFailedError,
    FallbackLLMClient,
    build_default_fallback_client,
)


class FakeSucceedingClient:
    def __init__(self, response: str):
        self._response = response
        self.called = False

    def complete(self, system_prompt: str, user_message: str) -> str:
        self.called = True
        return self._response


class FakeFailingClient:
    def __init__(self, error: Exception):
        self._error = error
        self.called = False

    def complete(self, system_prompt: str, user_message: str) -> str:
        self.called = True
        raise self._error


def test_uses_first_provider_when_it_succeeds():
    first = FakeSucceedingClient("response from first")
    second = FakeSucceedingClient("response from second")
    chain = FallbackLLMClient([("first", first), ("second", second)])

    result = chain.complete("sys", "user")

    assert result == "response from first"
    assert first.called is True
    assert second.called is False  # never reached — first succeeded


def test_falls_back_to_second_provider_when_first_fails():
    first = FakeFailingClient(RuntimeError("rate limited"))
    second = FakeSucceedingClient("response from second")
    chain = FallbackLLMClient([("first", first), ("second", second)])

    result = chain.complete("sys", "user")

    assert result == "response from second"
    assert first.called is True
    assert second.called is True


def test_falls_through_multiple_failures_to_eventual_success():
    providers = [
        ("p1", FakeFailingClient(RuntimeError("p1 down"))),
        ("p2", FakeFailingClient(RuntimeError("p2 rate limited"))),
        ("p3", FakeFailingClient(TimeoutError("p3 timeout"))),
        ("p4", FakeSucceedingClient("p4 finally works")),
        ("p5", FakeSucceedingClient("should never be called")),
    ]
    chain = FallbackLLMClient(providers)

    result = chain.complete("sys", "user")

    assert result == "p4 finally works"
    assert providers[4][1].called is False  # p5 never reached


def test_raises_all_providers_failed_when_every_provider_fails():
    providers = [
        ("p1", FakeFailingClient(RuntimeError("p1 down"))),
        ("p2", FakeFailingClient(RuntimeError("p2 down"))),
    ]
    chain = FallbackLLMClient(providers)

    with pytest.raises(AllProvidersFailedError) as exc_info:
        chain.complete("sys", "user")

    assert len(exc_info.value.errors) == 2
    assert exc_info.value.errors[0][0] == "p1"
    assert exc_info.value.errors[1][0] == "p2"


def test_empty_provider_list_raises_immediately():
    with pytest.raises(ValueError):
        FallbackLLMClient([])


# --- build_default_fallback_client wiring tests (using monkeypatch, no real SDKs needed) ---


def test_build_default_client_with_all_three_providers_yields_six_models(monkeypatch):
    import tegata_agent.llm_client as llm_client_module

    monkeypatch.setattr(
        llm_client_module,
        "GeminiLLMClient",
        lambda key, model: FakeSucceedingClient(f"gemini:{model}"),
    )
    monkeypatch.setattr(
        llm_client_module, "GroqLLMClient", lambda key, model: FakeSucceedingClient(f"groq:{model}")
    )
    monkeypatch.setattr(
        llm_client_module,
        "OpenRouterLLMClient",
        lambda key, model: FakeSucceedingClient(f"openrouter:{model}"),
    )

    chain = build_default_fallback_client(
        gemini_api_key="g-key", groq_api_key="grok-key", openrouter_api_key="or-key"
    )

    assert len(chain._providers) == 6
    names = [name for name, _ in chain._providers]
    assert names[0].startswith("gemini:")
    assert names[1].startswith("gemini:")
    assert names[2].startswith("groq:")
    assert names[3].startswith("groq:")
    assert names[4].startswith("openrouter:")
    assert names[5].startswith("openrouter:")


def test_build_default_client_skips_providers_without_api_keys(monkeypatch):
    import tegata_agent.llm_client as llm_client_module

    monkeypatch.setattr(
        llm_client_module, "GroqLLMClient", lambda key, model: FakeSucceedingClient(f"groq:{model}")
    )

    chain = build_default_fallback_client(groq_api_key="grok-key")

    assert len(chain._providers) == 2  # only groq's 2 models, gemini/openrouter skipped
    assert all(name.startswith("groq:") for name, _ in chain._providers)


def test_build_default_client_with_no_keys_raises_on_construction():
    with pytest.raises(ValueError):
        build_default_fallback_client()
