import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { ChatFlowError, runChatFlow } from "@/lib/datatalk/chat-flow";

const bodySchema = z.object({
  conversationId: z.string().uuid().optional().nullable(),
  message: z.string().min(1).max(8000),
  /** User confirmed extra checks and may accept slower response. */
  strictVerification: z.boolean().optional(),
  /** Next page of last query — 15 rows per page */
  resultOffset: z.number().int().min(0).optional(),
});

/** Word-ish tokens (keeps spaces) so the UI can reveal text smoothly. */
function splitTextForStreaming(text: string): string[] {
  const tokens = text.match(/\S+\s*/g) ?? (text ? [text] : []);
  if (!tokens.length) return [""];
  const maxChunks = 280;
  if (tokens.length <= maxChunks) return tokens;
  const group = Math.ceil(tokens.length / maxChunks);
  const merged: string[] = [];
  for (let i = 0; i < tokens.length; i += group) {
    merged.push(tokens.slice(i, i + group).join(""));
  }
  return merged;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}


export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const wantsStream = request.headers.get("accept")?.includes("text/event-stream");
  const { message, conversationId: rawConversationId, resultOffset } = parsed.data;
  // Enforce strict verification on all chat runs so SQL-backed answers consistently
  // receive the extra review pass without requiring an explicit user action.
  const strictVerification = true;
  const incomingConversationId = rawConversationId ?? null;

  if (!wantsStream) {
    try {
      const payload = await runChatFlow({
        supabase,
        userId: user.id,
        message,
        incomingConversationId,
        strictVerification,
        resultOffset,
      });
      return NextResponse.json(payload);
    } catch (e) {
      if (e instanceof ChatFlowError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      return NextResponse.json({ error: "Failed to process chat request" }, { status: 500 });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: string, payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };

      void (async () => {
        try {
          const payload = await runChatFlow({
            supabase,
            userId: user.id,
            message,
            incomingConversationId,
            strictVerification,
            resultOffset,
            onProgress: emit,
          });

          const chunks = splitTextForStreaming(payload.assistant_message);
          for (let i = 0; i < chunks.length; i += 1) {
            emit("assistant_delta", { delta: chunks[i] });
            // Pace chunks so the client can render progressively (avoid one blob frame).
            const base = chunks.length > 120 ? 4 : 12;
            const jitter = chunks.length > 120 ? 6 : 18;
            await delay(base + Math.random() * jitter);
          }

          emit("final", payload);
        } catch (e) {
          if (e instanceof ChatFlowError) {
            emit("error", { error: e.message, status: e.status });
          } else {
            emit("error", { error: "Failed to process chat request", status: 500 });
          }
        } finally {
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
