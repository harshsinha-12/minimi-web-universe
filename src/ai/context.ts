import { createHash } from "node:crypto";
import { cached } from "../cache/redis";
import { Store } from "../db/store";
import { resolveDate } from "../time/resolve";
import type { Message } from "../types";
import { semanticRecall } from "../memory/semantic";
import { pineconeReady } from "./__tools__/tool__pinecone";
import { rankMemories, type ProfileMode } from "./memory-rank";
export async function buildContext(
  store: Store,
  owner: string,
  conversationId: string,
  question: string,
  timezone: string,
  clock = new Date(),
  signal?: AbortSignal,
  profile: ProfileMode = "personal",
) {
  const recent = store.messages(owner, conversationId).slice(-20);
  const dated = resolveDate(question, timezone, clock);
  const continuesDate =
    !dated &&
    /\b(?:other|another)\s+(?:chats?|threads?|conversations?)\b|\btry again\b|^again[.!?]?$/i.test(
      question,
    );
  const inherited = continuesDate
    ? recent.reduceRight<ReturnType<typeof resolveDate>>((found, message) => {
        if (found || message.role !== "user" || message.content === question)
          return found;
        return resolveDate(message.content, timezone, clock);
      }, null)
    : null;
  const window = dated ?? inherited;
  const historical =
    Boolean(window) ||
    /\b(remember|recall|earlier|previous|last|shortlist|we (discussed|compared|talked)|what did|what have|chats?|messages?|days? ago|weeks? ago|i ask|i said|since|second|third|first one|those|them)\b/i.test(
      question,
    );
  const o = store.owner(owner);
  const key = `minimi:context:v2:${profile}:${owner}:${o.revision}:${o.memory_revision}:${createHash(
    "sha256",
  )
    .update(JSON.stringify([question, timezone, window]))
    .digest("hex")}`;
  const crossThread = profile === "personal" || historical;
  // Preferences can matter without words such as "remember" or "earlier".
  const lexical = crossThread
    ? await cached(key, () => {
        const hits = store.history(
          owner,
          window ? { ...window, limit: 400 } : { query: question, limit: 30 },
        );
        return historical && !window && !hits.length
          ? store.history(owner, { limit: 70 })
          : hits;
      })
    : [];
  const semanticEnabled = pineconeReady() && !process.env.VITEST;
  let semantic: Message[] = [];
  let semanticUnavailable = false;
  const semanticSkipped: "date" | "conversation" | null = !semanticEnabled
    ? null
    : window
      ? "date"
      : !crossThread
        ? "conversation"
        : null;
  if (semanticEnabled && !semanticSkipped) {
    try {
      semantic = await semanticRecall(
        store,
        owner,
        question,
        signal
          ? AbortSignal.any([signal, AbortSignal.timeout(2500)])
          : undefined,
      );
    } catch {
      semantic = [];
      semanticUnavailable = true;
    }
  }
  // A cached value is a candidate, never authority after a concurrent edit/delete.
  const hydrated = lexical.flatMap((m) => {
    const current = store.message(owner, m.id);
    return current ? [current] : [];
  });
  const older = window ? hydrated : fuseRecall(hydrated, semantic);
  const combined = new Map<string, Message>();
  const memories =
    profile === "vanilla"
      ? []
      : rankMemories(
          store
            .memories(owner)
            .filter((m) =>
              m.sources.every((s) => store.message(owner, s.messageId)),
            ),
          question,
        );
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
    otherChats: continuesDate,
    revision: o.revision,
    semanticHits: semantic.length,
    pinecone: {
      enabled: semanticEnabled,
      skipped: semanticSkipped,
      hits: semantic.length,
      unavailable: semanticUnavailable,
    },
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
