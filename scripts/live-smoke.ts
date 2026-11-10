import { consumeEvents } from "../src/stream/sse";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
const boot = await fetch(`${base}/api/bootstrap`);
const cookie = boot.headers.get("set-cookie")?.split(";")[0] || "";
const headers = { "Content-Type": "application/json", Cookie: cookie };
const thread = await (
  await fetch(`${base}/api/conversations`, { method: "POST", headers })
).json();
const question =
  process.argv.slice(2).join(" ") ||
  "What is the capital of France? Answer in one sentence.";
const start = Date.now();
const r = await fetch(`${base}/api/chat`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    conversationId: thread.id,
    requestId: crypto.randomUUID(),
    message: question,
    timezone: "Asia/Kolkata",
    forceSearch: /search|pricing|latest/i.test(question),
  }),
});
if (!r.ok || !r.body) {
  console.log("Request failed:", r.status);
  process.exitCode = 1;
} else
  await consumeEvents(r.body, (e) => {
    if (e.type === "done") {
      const m = e.message as {
        content: string;
        citations: unknown[];
        sources: unknown[];
      };
      console.log(
        JSON.stringify(
          {
            status: "completed",
            elapsedMs: Date.now() - start,
            answer: m.content,
            citations: m.citations.length,
            sources: m.sources.length,
            metrics: e.metrics,
          },
          null,
          2,
        ),
      );
    }
    if (e.type === "error") {
      console.log("Agent error:", e.error);
      process.exitCode = 1;
    }
  });
