import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const DEFAULT_STT_MODEL = "openai/whisper-tiny";
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

type HuggingFaceSttResponse = {
  text?: string;
  error?: string;
};

function sttEndpoints(model: string): string[] {
  const encoded = encodeURIComponent(model);
  return [
    `https://router.huggingface.co/hf-inference/models/${encoded}`,
    `https://api-inference.huggingface.co/models/${encoded}`,
  ];
}

async function readResponseBody(res: Response): Promise<{ json: unknown | null; text: string }> {
  const text = await res.text().catch(() => "");
  if (!text) {
    return { json: null, text: "" };
  }

  try {
    return { json: JSON.parse(text) as unknown, text };
  } catch {
    return { json: null, text };
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.HUGGINGFACE_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Set HUGGINGFACE_API_KEY to enable speech-to-text." },
      { status: 500 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data." }, { status: 400 });
  }

  const audio = formData.get("audio");
  if (!(audio instanceof File)) {
    return NextResponse.json({ error: "Missing audio file under 'audio' field." }, { status: 400 });
  }

  if (audio.size === 0) {
    return NextResponse.json({ error: "Audio file is empty." }, { status: 400 });
  }

  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "Audio exceeds 10MB limit. Please record a shorter clip." },
      { status: 413 },
    );
  }

  const model = process.env.HUGGINGFACE_STT_MODEL?.trim() || DEFAULT_STT_MODEL;
  const audioBuffer = Buffer.from(await audio.arrayBuffer());
  let lastError = "Speech-to-text request failed.";
  let sawStatusCode = 502;

  const endpoints = sttEndpoints(model);
  for (const [index, endpoint] of endpoints.entries()) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": audio.type || "application/octet-stream",
      },
      body: audioBuffer,
    });

    const body = await readResponseBody(res);
    const payload = body.json as HuggingFaceSttResponse | null;
    if (res.ok) {
      const text = payload?.text?.trim();
      if (!text) {
        lastError = "No transcript returned by model.";
        sawStatusCode = 502;
        continue;
      }
      return NextResponse.json({ text, model });
    }

    const message =
      payload?.error || body.text.slice(0, 300) || "Speech-to-text request failed.";
    lastError = `STT HTTP ${res.status}: ${message}`;
    sawStatusCode = res.status === 503 ? 503 : 502;

    const canTryFallback =
      index < endpoints.length - 1 &&
      endpoint.includes("router.huggingface.co") &&
      (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 410);

    if (!canTryFallback) {
      break;
    }
  }

  return NextResponse.json({ error: lastError }, { status: sawStatusCode });
}
