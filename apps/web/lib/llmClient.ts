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

/** Per-provider timeout (found 2026-08-29): with no timeout at all, one
 * hung provider stalled Armand's ENTIRE 6-model fallback chain for
 * several minutes — fetch() has no default timeout, so a provider that
 * never responds blocks everything after it in the chain, not just
 * itself. 15s is generous for a single completion call but still
 * bounds the worst case (6 providers) to ~90s instead of unbounded. */
const PROVIDER_TIMEOUT_MS = 15_000;

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

/** Model IDs confirmed via a real web search on 2026-08-29 (both are GA/
 * stable per ai.google.dev as of this date) — gemini-3.6-flash-lite,
 * used here previously, was a guess that turned out wrong (confirmed
 * 404 NOT_FOUND against the real API, exactly as this file originally
 * flagged as a risk). Recheck ai.google.dev/gemini-api/docs/models
 * before trusting these past the hackathon deadline; Google's Flash
 * line moves fast (3.6 -> 3.7 shipped three weeks apart per Google's
 * own announcement). */
export class GeminiLLMClient implements LLMClient {
  constructor(
    private apiKey: string,
    private model: string
  ) {}

  async complete(systemPrompt: string, userMessage: string): Promise<string> {
    // x-goog-api-key header, not ?key= query param — matches Google's
    // current documented curl example for gemini-3.7-flash exactly
    // (both historically work, but this is what's actually documented
    // now).
    //
    // AbortController timeout (found 2026-08-29): with no timeout at
    // all, a single hung/overloaded provider stalled the ENTIRE 6-model
    // fallback chain for minutes — fetch() has no default timeout in
    // Node/browsers, so a provider that never responds (not even with
    // an error) blocks every provider after it in the chain
    // indefinitely, not just its own call.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: `${systemPrompt}\n\n${userMessage}` }] }] }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("");
      if (!text) throw new Error("Gemini API returned no text content");
      return text;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Gemini API timed out after ${PROVIDER_TIMEOUT_MS}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
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
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Groq API error ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error("Groq API returned no message content");
      return text;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw new Error(`Groq API timed out after ${PROVIDER_TIMEOUT_MS}ms`);
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Uses two SPECIFIC free Nvidia Nemotron models instead of OpenRouter's
 * generic "openrouter/free" auto-router. Confirmed real slugs via a web
 * search of OpenRouter's own model pages, 2026-08-29:
 *   - nvidia/nemotron-3-ultra-550b-a55b:free
 *   - nvidia/nemotron-3.5-lightning:free
 * Switched after "openrouter/free" hit a 429 in real testing
 * ("Provider returned error... z-ai/glm-5.2:free is temporarily
 * rate-limited upstream") — the auto-router can land on whichever
 * underlying free model is currently least overloaded, which showed up
 * as z-ai/glm-5.2 that time, not necessarily anything Nvidia-branded.
 * Pinning to two specific, named free models means each one likely has
 * its own separate rate-limit pool rather than sharing the auto-router's
 * pool with every other OpenRouter free-tier user regardless of which
 * model they end up routed to — NOT independently confirmed how
 * OpenRouter scopes free-tier rate limits internally, this is a
 * reasonable inference from the auto-router's behavior, not a
 * guarantee. */
export class OpenRouterLLMClient implements LLMClient {
  constructor(
    private apiKey: string,
    private model: string,
    private maxTokens = 1024
  ) {}

  async complete(systemPrompt: string, userMessage: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
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
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`OpenRouter API error ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error("OpenRouter API returned no message content");
      return text;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw new Error(`OpenRouter API timed out after ${PROVIDER_TIMEOUT_MS}ms`);
      throw err;
    } finally {
      clearTimeout(timeout);
    }
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
    // gemini-3.7-flash: newest GA flagship (shipped 2026-08-13,
    // confirmed via web search 2026-08-29). gemini-3.5-flash-lite:
    // confirmed real lite-tier model, replaces the previous (wrong)
    // gemini-3.6-flash-lite guess that 404'd in real testing.
    for (const model of ["gemini-3.7-flash", "gemini-3.5-flash-lite"]) {
      providers.push({ name: `gemini:${model}`, client: new GeminiLLMClient(geminiKey, model) });
    }
  }
  if (groqKey) {
    for (const model of ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]) {
      providers.push({ name: `groq:${model}`, client: new GroqLLMClient(groqKey, model) });
    }
  }
  if (openrouterKey) {
    for (const model of ["nvidia/nemotron-3-ultra-550b-a55b:free", "nvidia/nemotron-3.5-lightning:free"]) {
      providers.push({ name: `openrouter:${model}`, client: new OpenRouterLLMClient(openrouterKey, model) });
    }
  }

  return new FallbackLLMClient(providers);
}
