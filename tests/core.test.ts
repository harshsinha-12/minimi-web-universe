import { afterEach, describe, expect, it, vi } from "vitest";
import { Store } from "../src/db/store";
import { resolveDate } from "../src/time/resolve";
import { consumeEvents } from "../src/stream/sse";
import { normalizeResponse, annotateMarkdown } from "../src/ai/evidence";
import { MemoryProposal } from "../src/memory/schema";
import { researchPolicy } from "../src/ai/policy";
import { assertOrigin } from "../src/server/origin";
import { buildContext } from "../src/ai/context";
import type { Response } from "openai/resources/responses/responses";
import { randomUUID } from "node:crypto";
const stores: Store[] = [];
vi.mock("../src/cache/redis", () => ({
  cached: async (_key: string, load: () => unknown) => load(),
}));
function setup() {
  const store = new Store(":memory:");
  stores.push(store);
  store.owner("alice");
  store.owner("bob");
  const id = store.createConversation("alice");
  return { store, id };
}
function exchange(
  store: Store,
  id: string,
  text = "I prefer concise answers.",
  at?: string,
) {
  const { run } = store.begin("alice", id, randomUUID(), text, at);
  store.finish("alice", run.id, "Understood.", [], [], [], {});
  return store.messages("alice", id);
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  vi.restoreAllMocks();
});

describe("timezone-aware historical dates", () => {
  const clock = new Date("2026-11-10T12:00:00Z");
  it("resolves last Tuesday strictly before a Tuesday", () =>
    expect(resolveDate("last Tuesday", "Asia/Kolkata", clock)?.label).toBe(
      "3 November 2026",
    ));
  it("resolves explicit day before month", () =>
    expect(
      resolveDate("What did I ask on 3 November?", "Asia/Kolkata", clock)?.from,
    ).toBe("2026-11-02T18:30:00.000Z"));
  it("resolves explicit month before day", () =>
    expect(resolveDate("November 3, 2026", "UTC", clock)?.label).toBe(
      "3 November 2026",
    ));
  it("uses local midnight for yesterday", () =>
    expect(
      resolveDate("yesterday", "Asia/Kolkata", new Date("2026-11-10T20:00:00Z"))
        ?.label,
    ).toBe("10 November 2026"));
  it("handles year rollover", () =>
    expect(
      resolveDate("last Thursday", "UTC", new Date("2027-01-01T12:00:00Z"))
        ?.label,
    ).toBe("31 December 2026"));
  it("honors a 25-hour daylight-saving day", () => {
    const d = resolveDate("2026-11-01", "America/New_York", clock)!;
    expect((Date.parse(d.to) - Date.parse(d.from)) / 3600000).toBe(25);
  });
  it("rejects impossible calendar dates", () =>
    expect(resolveDate("31 November", "UTC", clock)).toBeNull());
  it("returns no invented date for a vague reference", () =>
    expect(resolveDate("our earlier comparison", "UTC", clock)).toBeNull());
});

describe("browser request origin", () => {
  it("accepts the same public host when Next internally uses localhost", () =>
    expect(() =>
      assertOrigin(
        new Request("http://localhost:3000/api/chat", {
          headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
        }),
      ),
    ).not.toThrow());
  it("rejects a cross-site browser POST", () =>
    expect(() =>
      assertOrigin(
        new Request("http://localhost:3000/api/chat", {
          headers: {
            host: "localhost:3000",
            origin: "https://elsewhere.example",
          },
        }),
      ),
    ).toThrow("Cross-origin"));
  it("allows non-browser clients without an Origin header", () =>
    expect(() =>
      assertOrigin(new Request("http://localhost:3000/api/chat")),
    ).not.toThrow());
});

describe("search decisions", () => {
  it("requires current research for a price recheck", () =>
    expect(
      researchPolicy("Has the price changed since last week?", false, true)
        .required,
    ).toBe(true));
  it("does not search to recover a dated conversation", () =>
    expect(
      researchPolicy("What did I ask on 3 November?", false, true).allow,
    ).toBe(false));
  it("respects an explicit do-not-search instruction", () =>
    expect(
      researchPolicy("What did I ask? Don't search.", true, true),
    ).toMatchObject({ allow: false, required: false }));
  it("leaves optional search available for an uncertain general question", () =>
    expect(
      researchPolicy("Explain Raft consensus", false, false),
    ).toMatchObject({ allow: true, required: false }));
});

describe("durable conversation boundaries", () => {
  it("scopes conversation messages to their owner", () => {
    const { store, id } = setup();
    exchange(store, id);
    expect(store.messages("bob", id)).toEqual([]);
    expect(store.conversation("bob", id)).toBeUndefined();
  });
  it("rejects writing into another owner's thread", () => {
    const { store, id } = setup();
    expect(() => store.begin("bob", id, randomUUID(), "intrude")).toThrow(
      "not found",
    );
  });
  it("deduplicates a request before appending another user message", () => {
    const { store, id } = setup();
    const request = randomUUID();
    const a = store.begin("alice", id, request, "Hello");
    const b = store.begin("alice", id, request, "Hello");
    expect(b.duplicate).toBe(true);
    expect(b.run.id).toBe(a.run.id);
    expect(store.messages("alice", id)).toHaveLength(1);
  });
  it("rejects overlapping runs", () => {
    const { store, id } = setup();
    store.begin("alice", id, randomUUID(), "first");
    expect(() => store.begin("alice", id, randomUUID(), "second")).toThrow(
      "running",
    );
  });
  it("does not overwrite an interrupted terminal run", () => {
    const { store, id } = setup();
    const { run } = store.begin("alice", id, randomUUID(), "Hello");
    store.finish("alice", run.id, "Stopped", [], [], [], {}, "interrupted");
    expect(
      store.finish("alice", run.id, "Late answer", [], [], [], {}),
    ).toBeNull();
    expect(store.run("alice", run.id)?.status).toBe("interrupted");
  });
  it("does not expose another owner's run", () => {
    const { store, id } = setup();
    const { run } = store.begin("alice", id, randomUUID(), "Hello");
    expect(store.run("bob", run.id)).toBeNull();
  });
  it("retrieves date-only questions without a keyword", () => {
    const { store, id } = setup();
    exchange(store, id, "Which Postgres host?", "2026-11-03T08:00:00.000Z");
    const result = store.history("alice", {
      from: "2026-11-03T00:00:00.000Z",
      to: "2026-11-04T00:00:00.000Z",
    });
    expect(result.map((m) => m.content)).toContain("Which Postgres host?");
  });
  it("finds history across threads", () => {
    const { store, id } = setup();
    exchange(store, id, "We shortlisted Neon and Supabase for Postgres.");
    const second = store.createConversation("alice");
    exchange(store, second, "I like cats.");
    const result = store.history("alice", { query: "Postgres" });
    expect(result[0].conversationId).toBe(id);
  });
  it("handles punctuation in FTS queries without SQL or FTS injection", () => {
    const { store, id } = setup();
    exchange(store, id, "Postgres hosting");
    expect(() =>
      store.history("alice", { query: 'Postgres " OR 1=1; --' }),
    ).not.toThrow();
    expect(store.history("bob", { query: "Postgres" })).toEqual([]);
  });
  it("keeps outbox and the answer in the same durable transition", () => {
    const { store, id } = setup();
    const { run } = store.begin("alice", id, randomUUID(), "Hello");
    expect(store.db.prepare("SELECT * FROM memory_jobs").all()).toHaveLength(0);
    store.finish("alice", run.id, "Hi", [], [], [], {});
    expect(store.db.prepare("SELECT * FROM memory_jobs").all()).toHaveLength(1);
  });
});

describe("source-linked consolidation and recovery", () => {
  function ready() {
    const { store, id } = setup();
    const [user] = exchange(store, id);
    store.schedule("alice", true);
    const job = store.claimJob()!;
    const entry = {
      kind: "preference",
      text: "Prefers concise answers",
      sources: [{ messageId: user.id, quote: "prefer concise answers" }],
      validUntil: null,
    };
    return { store, id, user, job, entry };
  }
  it("accepts a supported original user span", () => {
    const { store, job, entry } = ready();
    expect(store.completeMemory(job, [entry])).toBe(true);
    expect(store.memories("alice")[0].sources[0].quote).toBe(
      "prefer concise answers",
    );
  });
  it("rejects a fabricated supporting quote", () => {
    const { store, job, entry } = ready();
    expect(
      store.completeMemory(job, [
        {
          ...entry,
          sources: [{ ...entry.sources[0], quote: "I live in Paris" }],
        },
      ]),
    ).toBe(false);
  });
  it("rejects a source from another user", () => {
    const { store, job, entry } = ready();
    const id = store.createConversation("bob");
    const { run } = store.begin(
      "bob",
      id,
      randomUUID(),
      "prefer concise answers",
    );
    const foreign = store.messages("bob", id)[0];
    expect(
      store.completeMemory(job, [
        {
          ...entry,
          sources: [{ messageId: foreign.id, quote: foreign.content }],
        },
      ]),
    ).toBe(false);
    store.finish("bob", run.id, "ok", [], [], [], {});
  });
  it("rejects stale synthesis after a new correction", () => {
    const { store, id, job, entry } = ready();
    exchange(store, id, "Actually I want detailed answers now.");
    expect(store.completeMemory(job, [entry])).toBe(false);
  });
  it("rejects a worker with an expired lease", () => {
    const { store, job, entry } = ready();
    store.db.prepare("UPDATE memory_jobs SET lease_until=0").run();
    expect(store.completeMemory(job, [entry])).toBe(false);
  });
  it("recovers an abandoned lease with a new token", () => {
    const { store, job } = ready();
    store.db.prepare("UPDATE memory_jobs SET lease_until=0,due_at=0").run();
    const replacement = store.claimJob()!;
    expect(replacement.token).not.toBe(job.token);
    expect(replacement.owner).toBe("alice");
  });
  it("does not resurrect forgotten content through a paraphrase", () => {
    const { store, job, entry } = ready();
    store.completeMemory(job, [entry]);
    store.forget("alice", store.memories("alice")[0].id);
    const next = store.claimJob()!;
    expect(
      store.completeMemory(next, [{ ...entry, text: "Likes brevity" }]),
    ).toBe(false);
    expect(store.memories("alice")).toEqual([]);
  });
  it("preserves unrelated memories when one source is forgotten", () => {
    const { store, id } = setup();
    const [first] = exchange(store, id, "I prefer concise answers.");
    const second = exchange(store, id, "My team has 20 people.")
      .filter((m) => m.role === "user")
      .at(-1)!;
    store.schedule("alice", true);
    const job = store.claimJob()!;
    store.completeMemory(job, [
      {
        kind: "preference",
        text: "Prefers concise answers",
        sources: [{ messageId: first.id, quote: "prefer concise answers" }],
        validUntil: null,
      },
      {
        kind: "constraint",
        text: "Team has 20 people",
        sources: [{ messageId: second.id, quote: "team has 20 people" }],
        validUntil: null,
      },
    ]);
    store.forget(
      "alice",
      store.memories("alice").find((m) => m.kind === "preference")!.id,
    );
    expect(store.memories("alice").map((m) => m.text)).toEqual([
      "Team has 20 people",
    ]);
  });
  it("rejects assistant prose as user memory evidence", () => {
    const { store, id, job, entry } = ready();
    const assistant = store.messages("alice", id)[1];
    expect(
      store.completeMemory(job, [
        {
          ...entry,
          sources: [{ messageId: assistant.id, quote: assistant.content }],
        },
      ]),
    ).toBe(false);
  });
  it("does not return expired memory as applicable context", () => {
    const { store, job, entry } = ready();
    store.completeMemory(job, [
      { ...entry, validUntil: "2000-01-01T00:00:00.000Z" },
    ]);
    expect(store.memories("alice")).toEqual([]);
  });
  it("rejects a schema without supporting sources", () => {
    expect(
      MemoryProposal.safeParse({
        entries: [
          { kind: "decision", text: "Made up", sources: [], validUntil: null },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("history context assembly", () => {
  it("retrieves a corrected preference without historical keywords or consolidated memory", async () => {
    const { store, id } = setup();
    exchange(store, id, "Use US hosting prices.", "2026-11-03T06:00:00.000Z");
    exchange(
      store,
      id,
      "Correction: use India hosting prices, not US prices.",
      "2026-11-04T06:00:00.000Z",
    );
    const target = store.createConversation("alice");
    const context = await buildContext(
      store,
      "alice",
      target,
      "Which region should you use for my hosting recommendations? Do not search.",
      "Asia/Kolkata",
    );
    expect(context.historical).toBe(false);
    expect(context.memories).toEqual([]);
    expect(
      context.messages.some((message) =>
        message.content.includes("Correction: use India"),
      ),
    ).toBe(true);
  });
  it("keeps more than fifty dated user messages available", async () => {
    const { store, id } = setup();
    for (let i = 0; i < 60; i++)
      exchange(
        store,
        id,
        `Historical question ${i}`,
        `2026-11-03T08:${String(i).padStart(2, "0")}:00.000Z`,
      );
    const context = await buildContext(
      store,
      "alice",
      id,
      "What did I ask on 3 November?",
      "Asia/Kolkata",
      new Date("2026-11-11T00:00:00Z"),
    );
    expect(context.messages.filter((m) => m.role === "user")).toHaveLength(60);
    expect(context.dateTruncated).toBe(false);
  });
  it("reports a missing date without substituting another day's history", async () => {
    const { store, id } = setup();
    exchange(store, id, "Something else", "2026-11-02T08:00:00.000Z");
    const context = await buildContext(
      store,
      "alice",
      id,
      "What did I ask on 3 November?",
      "UTC",
      new Date("2026-11-11T00:00:00Z"),
    );
    expect(context.missing).toBe(true);
  });
  it("hydrates original source messages behind consolidated memory", async () => {
    const { store, id } = setup();
    const [user] = exchange(store, id, "My team has 20 people.");
    store.schedule("alice", true);
    const job = store.claimJob()!;
    store.completeMemory(job, [
      {
        kind: "constraint",
        text: "Team size is 20",
        sources: [{ messageId: user.id, quote: "team has 20 people" }],
        validUntil: null,
      },
    ]);
    const other = store.createConversation("alice");
    const context = await buildContext(
      store,
      "alice",
      other,
      "Help me think",
      "UTC",
    );
    expect(
      context.messages.some(
        (m) => m.id === user.id && m.content === user.content,
      ),
    ).toBe(true);
  });
});

describe("stream framing", () => {
  it("reassembles fragmented UTF-8 and SSE frames", async () => {
    const encoded = new TextEncoder().encode(
      'data: {"type":"delta","text":"₹🙂"}\r\n\r\ndata: {"type":"done"}\n\n',
    );
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < encoded.length; i += 3)
          c.enqueue(encoded.slice(i, i + 3));
        c.close();
      },
    });
    const result: unknown[] = [];
    await consumeEvents(stream, (e) => result.push(e));
    expect(result).toEqual([{ type: "delta", text: "₹🙂" }, { type: "done" }]);
  });
  it("ignores heartbeat comments", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(
          new TextEncoder().encode(': keep-alive\n\ndata: {"type":"done"}\n\n'),
        );
        c.close();
      },
    });
    const events: unknown[] = [];
    await consumeEvents(stream, (e) => events.push(e));
    expect(events).toHaveLength(1);
  });
  it("reports a truncated frame", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"type":'));
        c.close();
      },
    });
    await expect(consumeEvents(stream, () => {})).rejects.toThrow(
      "interrupted",
    );
  });
});

describe("native citation normalization", () => {
  const response = {
    status: "completed",
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "Price [1]",
            annotations: [
              {
                type: "url_citation",
                url: "https://example.com/pricing",
                title: "Official pricing",
                start_index: 6,
                end_index: 9,
              },
            ],
          },
        ],
      },
      {
        type: "web_search_call",
        action: {
          type: "search",
          queries: ["pricing"],
          sources: [{ type: "url", url: "https://example.com/pricing" }],
        },
      },
    ],
  } as unknown as Response;
  it("preserves the citation and observed action", () => {
    const n = normalizeResponse(response);
    expect(n.citations[0]).toMatchObject({
      start: 6,
      end: 9,
      title: "Official pricing",
    });
    expect(n.actions).toHaveLength(1);
    expect(n.sources).toHaveLength(1);
  });
  it("renders an actual clickable source URL", () => {
    const n = normalizeResponse(response);
    expect(annotateMarkdown(n.text, n.citations)).toContain(
      "](＜".replace("＜", "<") + "https://example.com/pricing>",
    );
  });
  it("does not turn an incomplete provider response into completion", () =>
    expect(
      normalizeResponse({ ...response, status: "incomplete" } as Response)
        .complete,
    ).toBe(false));
  it("rejects citation offsets beyond the returned text", () => {
    const copy = structuredClone(response);
    const item = copy.output[0];
    if (
      item.type === "message" &&
      item.content[0].type === "output_text" &&
      item.content[0].annotations[0].type === "url_citation"
    )
      item.content[0].annotations[0].end_index = 9000;
    expect(normalizeResponse(copy).citations).toEqual([]);
  });
});
