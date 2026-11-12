import { createHash } from "node:crypto";
import { cached } from "../cache/redis";
import { Store } from "../db/store";
import { resolveDate } from "../time/resolve";
import type { Message } from "../types";
import { semanticRecall } from "../memory/semantic";
export async function buildContext(
  store: Store,
  owner: string,
  conversationId: string,
  question: string,
  timezone: string,
  clock = new Date(),
  signal?: AbortSignal,
) {
  const historical =
    /\b(remember|recall|earlier|previous|last|shortlist|we (discussed|compared|talked)|what did|what have|chats?|messages?|days? ago|weeks? ago|i ask|i said|since|second|third|first one|those|them)\b/i.test(
      question,
    );
  const window = historical ? resolveDate(question, timezone, clock) : null;
  const o = store.owner(owner);
  const key = `minimi:context:v1:${owner}:${o.revision}:${o.memory_revision}:${createHash(
    "sha256",
  )
    .update(JSON.stringify([question, timezone, window]))
    .digest("hex")}`;
  // Preferences can matter without words such as "remember" or "earlier".
  const lexical = await cached(key, () => {
    const hits = store.history(
      owner,
      window ? { ...window, limit: 400 } : { query: question, limit: 30 },
    );
    return historical && !window && !hits.length
      ? store.history(owner, { limit: 70 })
      : hits;
  });
  const semantic = window
    ? []
    : await semanticRecall(
        store,
        owner,
        question,
        signal
          ? AbortSignal.any([signal, AbortSignal.timeout(2500)])
          : undefined,
      );
  // A cached value is a candidate, never authority after a concurrent edit/delete.
  const hydrated = lexical.flatMap((m) => {
    const current = store.message(owner, m.id);
    return current ? [current] : [];
  });
  const older = window ? hydrated : fuseRecall(hydrated, semantic);
  const recent = store.messages(owner, conversationId).slice(-20);
  const combined = new Map<string, Message>();
  const memories = store
    .memories(owner)
    .filter((m) => m.sources.every((s) => store.message(owner, s.messageId)))
    .sort(
      (a, b) =>
        Number(Boolean(b.userEdited)) - Number(Boolean(a.userEdited)) ||
        b.createdAt.localeCompare(a.createdAt),
    )
    .slice(0, 20);
  for (const memory of memories)
    for (const source of memory.sources) {
      const original = store.message(owner, source.messageId);
      if (original) combined.set(original.id, original);
    }
  // Hydrate complete exchanges so a ranked user message retains its answer and ordered shortlist.
  const threads = new Map<string, Message[]>();
  for (const hit of window ? older : older.slice(0, 50)) {
    const thread =
      threads.get(hit.conversationId) ??
      store.messages(owner, hit.conversationId);
    threads.set(hit.conversationId, thread);
    const at = thread.findIndex((m) => m.id === hit.id);
    for (const m of thread.slice(Math.max(0, at - 1), at + 3))
      combined.set(m.id, m);
  }
  for (const m of recent) combined.set(m.id, m);
  const messages = [...combined.values()]
    .filter((m) => m.status === "completed")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const budget = 65000;
  let used = 0;
  const selected: Message[] = [];
  // Prefer explicit date hits and recent context, then hydrate remaining candidates within the budget.
  const inWindow = (m: Message) =>
    Boolean(window && m.createdAt >= window.from && m.createdAt < window.to);
  const priority = window
    ? [
        ...messages.filter(inWindow),
        ...messages.filter((m) => !inWindow(m)).reverse(),
      ]
    : [...messages].reverse();
  for (const m of priority) {
    if (used + m.content.length > budget) continue;
    used += m.content.length;
    selected.push(m);
  }
  selected.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    historical,
    window,
    messages: selected,
    memories,
    dateTruncated: Boolean(
      window &&
      (older.length >= 400 ||
        older.some((m) => !selected.some((s) => s.id === m.id))),
    ),
    missing:
      historical &&
      (window
        ? older.length === 0
        : older.filter((m) => m.content !== question).length === 0 &&
          recent.length <= 1),
    revision: o.revision,
    semanticHits: semantic.length,
  };
}

// Reciprocal rank fusion combines independent rankings without comparing BM25 to cosine scores.
export function fuseRecall(...rankings: Message[][]) {
  const entries = new Map<string, { message: Message; score: number }>();
  for (const ranking of rankings)
    ranking.forEach((message, index) => {
      const entry = entries.get(message.id) ?? { message, score: 0 };
      entry.score += 1 / (60 + index + 1);
      entries.set(message.id, entry);
    });
  return [...entries.values()]
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.message);
}
