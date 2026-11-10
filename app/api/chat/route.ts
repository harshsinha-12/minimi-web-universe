import { z } from "zod";
import { ownerSession, assertOrigin } from "@/server/session";
import { getStore } from "@/db/store";
import { runAgent } from "@/ai/__agents__/agent__master";
import { wakeMemory } from "@/cache/redis";
import { logger } from "@/server/logger";
export const runtime = "nodejs";
export const maxDuration = 120;
const input = z.object({
  conversationId: z.uuid(),
  requestId: z.uuid(),
  message: z.string().trim().min(1).max(12000),
  timezone: z.string().max(80).default("UTC"),
  forceSearch: z.boolean().default(false),
});
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const body = input.parse(await request.json());
    const owner = await ownerSession();
    const store = getStore();
    const { run, duplicate } = store.begin(
      owner,
      body.conversationId,
      body.requestId,
      body.message,
    );
    if (duplicate)
      return Response.json(
        { run, messages: store.messages(owner, body.conversationId) },
        { status: 409 },
      );
    const abort = new AbortController();
    request.signal.addEventListener("abort", () => abort.abort(), {
      once: true,
    });
    const encoder = new TextEncoder();
    let sequence = 0;
    let closed = false;
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (event: Record<string, unknown>) => {
          if (!closed)
            try {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ ...event, sequence: ++sequence })}\n\n`,
                ),
              );
            } catch {
              closed = true;
              abort.abort();
            }
        };
        emit({ type: "started", runId: run.id });
        const heartbeat = setInterval(() => {
          if (!closed)
            try {
              controller.enqueue(encoder.encode(": keep-alive\n\n"));
            } catch {
              closed = true;
              abort.abort();
            }
        }, 12000);
        try {
          await runAgent({
            store,
            owner,
            conversationId: body.conversationId,
            runId: run.id,
            question: body.message,
            timezone: body.timezone,
            forceSearch: body.forceSearch,
            signal: abort.signal,
            emit,
          });
          void wakeMemory(owner);
        } finally {
          clearInterval(heartbeat);
          if (!closed) {
            closed = true;
            controller.close();
          }
        }
      },
      cancel() {
        closed = true;
        abort.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    if (e instanceof z.ZodError)
      logger.warn(
        { component: "chat", issues: e.issues.length },
        "chat request rejected",
      );
    else logger.warn({ component: "chat", err: e }, "chat request rejected");
    const message =
      e instanceof z.ZodError
        ? "Please send a valid message and conversation."
        : e instanceof Error
          ? e.message
          : "Could not start this answer.";
    return Response.json(
      { error: message },
      {
        status: /not found/.test(message)
          ? 404
          : /running/.test(message)
            ? 409
            : 400,
      },
    );
  }
}
