import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Store } from "../src/db/store";
import { SemanticJobs } from "../src/memory/index-jobs";
import {
  chunkMessage,
  fingerprint,
  hydrateMatches,
  indexNextMessage,
  semanticNamespace,
} from "../src/memory/semantic";
import { fuseRecall } from "../src/ai/context";
import { scoreVerdict } from "../src/ai/__evals__/eval__schema";
import { webSearchTools } from "../src/ai/__tools__/tool__web_search";
import type { VectorIndex } from "../src/ai/__tools__/tool__pinecone";
const stores: Store[] = [];
function setup() {
  const store = new Store(":memory:");
  stores.push(store);
  const thread = store.createConversation("alice");
  const { run } = store.begin(
    "alice",
    thread,
    randomUUID(),
    "Use India prices.",
  );
  const message = store.messages("alice", thread)[0];
  return { store, thread, run, message, jobs: new SemanticJobs(store.db) };
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
describe("semantic memory boundaries", () => {
  it("enqueues in the message transaction and rolls back with it", () => {
    const { store, jobs } = setup();
    expect(() =>
      store.db.transaction(() => {
        const thread = store.createConversation("bob");
        store.begin("bob", thread, randomUUID(), "Do not commit this");
        throw new Error("rollback");
      })(),
    ).toThrow("rollback");
    expect(jobs.claim("v1")?.owner).toBe("alice");
    expect(jobs.claim("v1")).toBeNull();
  });
  it("only enqueues completed messages", () => {
    const { store, jobs, run } = setup();
    store.finish("alice", run.id, "stopped", [], [], [], {}, "interrupted");
    expect(jobs.claim("v1")).not.toBeNull();
    expect(jobs.claim("v1")).toBeNull();
  });
  it("reclaims expired leases and fences the old worker", () => {
    const { jobs } = setup();
    const old = jobs.claim("v1", 100)!;
    expect(jobs.claim("v1", 200)).toBeNull();
    const fresh = jobs.claim("v1", 60200)!;
    expect(jobs.complete(old, 60201)).toBe(false);
    jobs.retry(old, 60201);
    expect(jobs.complete(fresh, 60202)).toBe(true);
    expect(jobs.claim("v1", 60203)).toBeNull();
  });
  it("reindexes after the index/model configuration changes", () => {
    const { jobs } = setup();
    const first = jobs.claim("v1", 100)!;
    expect(jobs.complete(first, 101)).toBe(true);
    expect(jobs.claim("v1", 102)).toBeNull();
    expect(jobs.claim("v2", 103)?.indexKey).toBe("v2");
  });
  it("rejects cross-owner, stale and forgotten search results", () => {
    const { store, message } = setup();
    const match = {
      id: message.id + ":0",
      score: 0.9,
      metadata: {
        messageId: message.id,
        fingerprint: fingerprint(message.content),
      },
    };
    expect(hydrateMatches(store, "alice", [match, match])).toEqual([message]);
    expect(hydrateMatches(store, "bob", [match])).toEqual([]);
    expect(
      hydrateMatches(store, "alice", [
        { ...match, metadata: { ...match.metadata, fingerprint: "stale" } },
      ]),
    ).toEqual([]);
    store.db
      .prepare("INSERT INTO memory_exclusions VALUES(?,?)")
      .run("alice", message.id);
    expect(hydrateMatches(store, "alice", [match])).toEqual([]);
  });
  it("indexes canonical chunks with deterministic IDs and completes the durable job", async () => {
    const { store, message, jobs } = setup();
    const writes: unknown[] = [];
    const index: VectorIndex = {
      upsert: async (namespace, records) => {
        writes.push({ namespace, records });
      },
      query: async () => [],
    };
    expect(
      await indexNextMessage(store, index, async (input) => ({
        vectors: input.map(() => [0.1, 0.2]),
        tokens: 4,
      })),
    ).toEqual({ indexed: true, tokens: 4 });
    expect(writes).toEqual([
      {
        namespace: semanticNamespace("alice"),
        records: [
          {
            id: message.id + ":0",
            values: [0.1, 0.2],
            metadata: {
              messageId: message.id,
              fingerprint: fingerprint(message.content),
            },
          },
        ],
      },
    ]);
    expect(jobs.claim("another-index")?.messageId).toBe(message.id);
  });
  it("preserves a retryable outbox entry after provider failure", async () => {
    const { store } = setup();
    const index: VectorIndex = {
      upsert: async () => {
        throw new Error("outage");
      },
      query: async () => [],
    };
    expect(
      await indexNextMessage(store, index, async (input) => ({
        vectors: input.map(() => [1]),
        tokens: 1,
      })),
    ).toEqual({ indexed: false, tokens: 0 });
    expect(
      store.db.prepare("SELECT state,attempts FROM semantic_jobs").get(),
    ).toEqual({ state: "pending", attempts: 1 });
  });
  it("keeps tenant namespaces distinct and chunks Unicode safely", () => {
    expect(semanticNamespace("alice")).not.toBe(semanticNamespace("bob"));
    const chunks = chunkMessage("🧠".repeat(2500));
    expect(Array.from(chunks[0])).toHaveLength(2000);
    expect(chunks.some((c) => c.includes("\uFFFD"))).toBe(false);
    expect(chunkMessage("")).toEqual([]);
  });
  it("fuses rankings with a shared hit ahead of isolated hits", () => {
    const { message } = setup();
    const a = { ...message, id: "a" },
      b = { ...message, id: "b" };
    expect(fuseRecall([a, message], [b, message]).map((m) => m.id)).toEqual([
      message.id,
      "a",
      "b",
    ]);
  });
});
describe("evidence-aware evaluation contracts", () => {
  const score = { score: 4, reason: "supported" };
  const base = {
    recall: score,
    temporal: score,
    grounding: score,
    helpfulness: score,
    violations: [],
  };
  it("cannot average away an unsupported claim even with perfect style scores", () => {
    const result = scoreVerdict(
      {
        ...base,
        violations: [
          {
            type: "unsupported_claim",
            quote: "cut by 25%",
            evidenceIds: ["pricing"],
            explanation: "Annual and monthly billing differ",
          },
        ],
      },
      "The price was cut by 25%.",
      ["pricing"],
    );
    expect(result.passed).toBe(false);
  });
  it("rejects invented judge quotes and evidence references", () => {
    const issue = {
      type: "fabricated_history",
      quote: "not present",
      evidenceIds: [],
      explanation: "unsupported",
    };
    expect(() =>
      scoreVerdict({ ...base, violations: [issue] }, "Hello", []),
    ).toThrow("quote");
    expect(() =>
      scoreVerdict(
        {
          ...base,
          violations: [{ ...issue, quote: "Hello", evidenceIds: ["fake"] }],
        },
        "Hello",
        [],
      ),
    ).toThrow("evidence ID");
  });
  it("fails material criteria gaps and excludes inapplicable dimensions", () => {
    expect(
      scoreVerdict(
        { ...base, grounding: { score: 2, reason: "gap" } },
        "answer",
        [],
      ).passed,
    ).toBe(false);
    expect(
      scoreVerdict(
        { ...base, temporal: { score: null, reason: "not time-dependent" } },
        "answer",
        [],
      ),
    ).toMatchObject({ passed: true, score: 1 });
  });
  it("exposes exactly one hosted web tool, and none when disallowed", () => {
    expect(webSearchTools(true, true).map((tool) => tool.type)).toEqual([
      "web_search",
    ]);
    expect(webSearchTools(false, false)).toEqual([]);
  });
});
