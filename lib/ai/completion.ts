type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveEndpoint(): { url: string; apiKey: string; model: string; headers: Record<string, string> } {
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouterKey) {
    return {
      url: "https://openrouter.ai/api/v1/chat/completions",
      apiKey: openRouterKey,
      model: process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-4o-mini",
      headers: {
        "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER?.trim() || "https://datatalk.local",
        "X-Title": "DataTalk",
      },
    };
  }

  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openAiKey) {
    throw new Error("Set OPENROUTER_API_KEY or OPENAI_API_KEY for LLM calls.");
  }

  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  return {
    url: `${base}/chat/completions`,
    apiKey: openAiKey,
    model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    headers: {},
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(attempt: number, maxRetries: number, status?: number): boolean {
  if (attempt >= maxRetries) return false;
  if (status == null) return true;
  return status === 429 || status >= 500;
}

export async function chatCompletionJson(messages: ChatMessage[]): Promise<string> {
  const { url, apiKey, model, headers } = resolveEndpoint();
  const timeoutMs = parsePositiveIntEnv("LLM_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const maxRetries = parsePositiveIntEnv("LLM_MAX_RETRIES", DEFAULT_MAX_RETRIES);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...headers,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        const retryable = shouldRetry(attempt, maxRetries, res.status);
        const prefix = `LLM ${model} HTTP ${res.status}`;
        if (!retryable) {
          throw new Error(`${prefix}: ${text.slice(0, 500)}`);
        }
        lastError = new Error(`${prefix} (attempt ${attempt + 1}/${maxRetries + 1}): ${text.slice(0, 500)}`);
        const backoffMs = 250 * 2 ** attempt + Math.floor(Math.random() * 200);
        await delay(backoffMs);
        continue;
      }

      const body = (await res.json()) as {
        choices?: { message?: { content?: string | null } }[];
      };
      const content = body.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error(`LLM ${model} returned an empty message.`);
      }
      return content;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const isAbort = err.name === "AbortError";
      if (!shouldRetry(attempt, maxRetries) || (!isAbort && /HTTP 4\d{2}/.test(err.message))) {
        throw err;
      }
      lastError = isAbort
        ? new Error(`LLM ${model} request timed out after ${timeoutMs}ms (attempt ${attempt + 1}/${maxRetries + 1}).`)
        : new Error(`LLM ${model} request failed (attempt ${attempt + 1}/${maxRetries + 1}): ${err.message}`);
      const backoffMs = 250 * 2 ** attempt + Math.floor(Math.random() * 200);
      await delay(backoffMs);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError ?? new Error(`LLM ${model} request failed after ${maxRetries + 1} attempts.`);
}
