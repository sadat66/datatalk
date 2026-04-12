type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

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

export async function chatCompletionJson(messages: ChatMessage[]): Promise<string> {
  const { url, apiKey, model, headers } = resolveEndpoint();

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
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  const body = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned an empty message.");
  }
  return content;
}
