import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { getStore } from "../src/db/store";
import { consumeEvents } from "../src/stream/sse";
import type { Message } from "../src/types";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
const boot = await fetch(`${base}/api/bootstrap`);
const cookie = boot.headers.get("set-cookie")!.split(";")[0];
const token = cookie.slice(cookie.indexOf("=") + 1);
const owner = createHash("sha256").update(token).digest("hex");
const headers = { "Content-Type": "application/json", Cookie: cookie };
const store = getStore();
const fixture = store.createConversation(
  owner,
  "Synthetic QA: CRM shortlist on November 3",
);
const { run } = store.begin(
  owner,
  fixture,
  randomUUID(),
  "For my 20-person sales team, shortlist HubSpot, Pipedrive, Zoho CRM, Freshsales and Attio in that order.",
  "2026-11-03T08:00:00.000Z",
);
const prior = store.finish(
  owner,
  run.id,
  "The shortlist is: 1. HubSpot 2. Pipedrive 3. Zoho CRM 4. Freshsales 5. Attio. We have not recorded verified prices yet.",
  [],
  [],
  [],
  {},
)!;
store.db
  .prepare("UPDATE messages SET created_at=? WHERE id=?")
  .run("2026-11-03T08:01:00.000Z", prior.id);
const results: Record<string, unknown>[] = [];
async function ask(name: string, question: string) {
  const thread = await (
    await fetch(`${base}/api/conversations`, { method: "POST", headers })
  ).json();
  const start = Date.now();
  const r = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      conversationId: thread.id,
      requestId: randomUUID(),
      message: question,
      timezone: "Asia/Kolkata",
    }),
  });
  if (!r.body || !r.ok) throw new Error(`Request failed (${r.status})`);
  let result: Record<string, unknown> = { name, status: "incomplete" };
  await consumeEvents(r.body, (e) => {
    if (e.type === "done") {
      const m = e.message as Message;
      result = {
        name,
        status: "completed",
        elapsedMs: Date.now() - start,
        answer: m.content,
        citations: m.citations.length,
        metrics: e.metrics,
      };
    }
    if (e.type === "error") result = { name, status: "failed", error: e.error };
  });
  results.push(result);
  console.log(JSON.stringify(result, null, 2));
}
await ask(
  "dated-recall",
  "What did I ask you on 3 November? Do not search. Be concise.",
);
await ask(
  "ordered-reference",
  "In our CRM shortlist for the sales team, what was the second option? Do not search; one sentence.",
);
await ask(
  "memory-preference",
  "Please remember: I prefer brief answers and my sales team has 20 people. Acknowledge briefly, without web search.",
);
await ask(
  "recheck",
  "Have any of the five CRM tools we shortlisted on 3 November changed pricing since then? Check all five. If we don't have old verified prices, say so. Keep it concise and cite official sources.",
);
mkdirSync(".data/evals", { recursive: true });
writeFileSync(
  ".data/evals/live-scenarios.json",
  JSON.stringify({ at: new Date().toISOString(), results }, null, 2),
);
store.close();
