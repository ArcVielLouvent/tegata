/**
 * Server-only TS port of apps/agent/src/tegata_agent/llm_client.py —
 * only the fallback-chain shape and the 3 providers actually configured
 * in .env.example (Gemini, Groq, OpenRouter). Model names copied
 * verbatim from the Python original's confirmed/flagged values (see its
 * own comments for how each was verified) — do not "helpfully" update
 * them without the same kind of verification.
 *
 * NEVER import from a "use client" component — reads *_API_KEY env vars.
 */

export interface LLMClient {
  complete(systemPrompt: string, userMessage: string): Promise<string>;
}

export class AllProvidersFailedError extends Error {
  constructor(public errors: Array<{ name: string; error: unknown }>) {
    super(`All ${errors.length} LLM providers failed: ` + errors.map((e) => `${e.name}: ${e.error}`).join("; "));
  }
}

export class FallbackLLMClient implements LLMClient {
  constructor(private providers: Array<{ name: string; client: LLMClient }>) {
    if (providers.length === 0) throw new Error("FallbackLLMClient needs at least one provider");
  }

  async complete(systemPrompt: string, userMessage: string): Promise<string> {
    const errors: Array<{ name: string; error: unknown }> = [];
    for (const { name, client } of this.providers) {
      try {
        return await client.complete(systemPrompt, userMessage);
      } catch (error) {
        errors.push({ name, error });
      }
    }
    throw new AllProvidersFailedError(errors);
  }
}

/** Model name confirmed the same way as the Python client: a real
 * Gemini API error message (2026-08-24) reporting gemini-2.5-flash's
 * replacement. gemini-3.6-flash-lite is an EDUCATED GUESS following
 * Google's flash/flash-lite naming pattern, not independently
 * confirmed — same caveat as llm_client.py. */
export class GeminiLLMClient implements LLMClient {
  constructor(
    private apiKey: string,
    private model: string
  ) {}

  async complete(systemPrompt: string, userMessage: string): Promise<string> {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: `${systemPrompt}\n\n${userMessage}` }] }] }),
    });
    if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("");
    if (!text) throw new Error("Gemini API returned no text content");
    return text;
  }
}

/** Model names confirmed via Groq's official deprecation page
 * (console.groq.com/docs/deprecations, 2026-06-17), same as
 * llm_client.py — recheck that page before trusting these past the
 * hackathon deadline. */
export class GroqLLMClient implements LLMClient {
  constructor(
    private apiKey: string,
    private model: string,
    private maxTokens = 1024
  ) {}

  async complete(systemPrompt: string, userMessage: string): Promise<string> {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Groq API error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error("Groq API returned no message content");
    return text;
  }
}

/** OpenRouter's own auto-router ("openrouter/free") is used instead of
 * a pinned free-tier model slug — same reasoning as llm_client.py:
 * OpenRouter's free lineup was found to rotate weekly, so pinning broke
 * quickly in real testing. */
export class OpenRouterLLMClient implements LLMClient {
  constructor(
    private apiKey: string,
    private model: string,
    private maxTokens = 1024
  ) {}

  async complete(systemPrompt: string, userMessage: string): Promise<string> {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter API error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error("OpenRouter API returned no message content");
    return text;
  }
}

/** Same 6-model chain as llm_client.py's build_default_fallback_client:
 * 2 Gemini -> 2 Groq -> 2 OpenRouter, in that order. Reads *_API_KEY
 * directly from process.env; a missing key skips that provider's 2
 * models entirely rather than throwing. */
export function buildDefaultFallbackClient(): FallbackLLMClient {
  const providers: Array<{ name: string; client: LLMClient }> = [];
  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  if (geminiKey) {
    for (const model of ["gemini-3.6-flash", "gemini-3.6-flash-lite"]) {
      providers.push({ name: `gemini:${model}`, client: new GeminiLLMClient(geminiKey, model) });
    }
  }
  if (groqKey) {
    for (const model of ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]) {
      providers.push({ name: `groq:${model}`, client: new GroqLLMClient(groqKey, model) });
    }
  }
  if (openrouterKey) {
    for (const model of ["openrouter/free", "openrouter/free"]) {
      providers.push({ name: `openrouter:${model}`, client: new OpenRouterLLMClient(openrouterKey, model) });
    }
  }

  return new FallbackLLMClient(providers);
}
