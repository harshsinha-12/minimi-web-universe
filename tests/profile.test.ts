import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Store } from "../src/db/store";
import { buildContext } from "../src/ai/context";
import { rankMemories } from "../src/ai/memory-rank";
import type { Memory } from "../src/types";

vi.mock("../src/cache/redis", () => ({
  cached: async (_key: string, load: () => unknown) => load(),
}));

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  vi.restoreAllMocks();
});

function memory(
  patch: Partial<Memory> & Pick<Memory, "text" | "kind">,
): Memory {
  return {
    id: randomUUID(),
    sources: [{ messageId: "m", quote: "quote" }],
    validUntil: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    version: 1,
    ...patch,
  };
}

function setup() {
  const store = new Store(":memory:");
  stores.push(store);
  store.owner("alice");
  const thread = store.createConversation("alice");
  const remember = (text: string, at?: string) => {
    const { run } = store.begin("alice", thread, randomUUID(), text, at);
    store.finish("alice", run.id, "Understood.", [], [], [], {});
    return store
      .messages("alice", thread)
      .filter((item) => item.role === "user")
      .at(-1)!;
  };
  return { store, thread, remember };
}

async function context(
  store: Store,
  thread: string,
  question: string,
  profile: "personal" | "vanilla" = "personal",
) {
  return buildContext(
    store,
    "alice",
    thread,
    question,
    "UTC",
    new Date("2026-11-22T00:00:00Z"),
    undefined,
    profile,
  );
}

describe("ranked personal notes", () => {
  it("puts a correction ahead of a matching project and an unrelated preference", () => {
    const ranked = rankMemories(
      [
        memory({
          kind: "preference",
          text: "Prefers dark mode",
          createdAt: "2026-11-03T00:00:00.000Z",
        }),
        memory({
          kind: "project",
          text: "Postgres hosting stays in India",
          createdAt: "2026-11-02T00:00:00.000Z",
        }),
        memory({
          kind: "decision",
          text: "Use INR not USD",
          userEdited: true,
          createdAt: "2026-11-01T00:00:00.000Z",
        }),
      ],
      "Which hosting region should I use?",
    );
    expect(ranked.map((item) => item.text)).toEqual([
      "Use INR not USD",
      "Postgres hosting stays in India",
      "Prefers dark mode",
    ]);
  });
  it("keeps an expired, forgotten, or deleted note out of the next answer", async () => {
    const { store, remember } = setup();
    const kept = remember("My team has 20 people.");
    const dropped = remember("I prefer concise answers.");
    store.schedule("alice", true);
    store.completeMemory(store.claimJob()!, [
      {
        kind: "constraint",
        text: "Team size is 20",
        sources: [{ messageId: kept.id, quote: "team has 20 people" }],
        validUntil: null,
      },
      {
        kind: "preference",
        text: "Prefers concise answers",
        sources: [{ messageId: dropped.id, quote: "prefer concise answers" }],
        validUntil: "2000-01-01T00:00:00.000Z",
      },
    ]);
    const other = store.createConversation("alice");
    expect(
      (await context(store, other, "How should I plan the team?")).memories.map(
        (item) => item.text,
      ),
    ).toEqual(["Team size is 20"]);
    store.forget(
      "alice",
      store.memories("alice").find((item) => item.text === "Team size is 20")!
        .id,
    );
    const forgotten = await context(
      store,
      other,
      "How should I plan the team?",
    );
    expect(forgotten.memories).toEqual([]);
    store.deleteMessage("alice", dropped.id);
    const deleted = await context(store, other, "How should I plan the team?");
    expect(deleted.memories.map((item) => item.text)).not.toContain(
      "Prefers concise answers",
    );
    expect(deleted.messages.some((item) => item.id === dropped.id)).toBe(false);
  });
});

describe("vanilla profile", () => {
  it("uses another chat only when the question asks for it", async () => {
    const { store, remember } = setup();
    const source = remember("Use India hosting prices.");
    store.schedule("alice", true);
    store.completeMemory(store.claimJob()!, [
      {
        kind: "decision",
        text: "Hosting region is India",
        sources: [{ messageId: source.id, quote: "India hosting" }],
        validUntil: null,
      },
    ]);
    const current = store.createConversation("alice");
    const quiet = await context(
      store,
      current,
      "Which hosting region should I use?",
      "vanilla",
    );
    expect(quiet.memories).toEqual([]);
    expect(quiet.messages.some((item) => item.id === source.id)).toBe(false);
    const asked = await context(
      store,
      current,
      "What did we decide earlier about hosting?",
      "vanilla",
    );
    expect(asked.memories).toEqual([]);
    expect(asked.messages.some((item) => item.id === source.id)).toBe(true);
    const personal = await context(
      store,
      current,
      "Which hosting region should I use?",
    );
    expect(personal.memories.map((item) => item.text)).toEqual([
      "Hosting region is India",
    ]);
  });
});
