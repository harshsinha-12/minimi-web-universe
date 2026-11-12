import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Store } from "../src/db/store";
import { SemanticJobs, initializeSemanticJobs } from "../src/memory/index-jobs";
import { cleanupNextVectors } from "../src/memory/vector-cleanup";
import {
  indexNextMessage,
  fingerprint,
  hydrateMatches,
} from "../src/memory/semantic";
import { emptyAudit } from "../src/ai/claim-audit";
import type { VectorIndex } from "../src/ai/__tools__/tool__pinecone";
const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));
function setup() {
  const store = new Store(":memory:");
  stores.push(store);
  const thread = store.createConversation("alice");
  const { run } = store.begin(
    "alice",
    thread,
    randomUUID(),
    "I prefer concise replies. Secretword.",
  );
  const answer = store.finish(
    "alice",
    run.id,
    "Understood",
    [],
    [],
    [],
    {},
    "completed",
    null,
    emptyAudit(),
  )!;
  const user = store.messages("alice", thread)[0];
  store.schedule("alice", true);
  const job = store.claimJob()!;
  const entry = {
    kind: "preference",
    text: "Prefers concise replies",
    sources: [{ messageId: user.id, quote: "I prefer concise replies." }],
    validUntil: null,
  };
  expect(store.completeMemory(job, [entry])).toBe(true);
  return { store, thread, run, user, answer, entry };
}
describe("transcript and direct memory controls", () => {
  it("updates FTS, title, revisions, and derived memory atomically on edit", () => {
    const { store, user, thread } = setup();
    const before = store.owner("alice");
    store.editMessage("alice", user.id, "I prefer detailed replies. Newword.");
    expect(store.history("alice", { query: "Secretword" })).toEqual([]);
    expect(store.history("alice", { query: "Newword" })[0]?.id).toBe(user.id);
    expect(store.memories("alice")).toEqual([]);
    expect(store.conversations("alice")[0].title).toContain("detailed");
    expect(store.owner("alice").revision).toBe(before.revision + 1);
    expect(store.db.prepare("SELECT owner FROM cache_cleanup").get()).toEqual({
      owner: "alice",
    });
    expect(store.messages("alice", thread)[1].evidence).toBeUndefined();
  });
  it("prevents cross-owner editing and deletion with no collateral changes", () => {
    const { store, user, thread } = setup();
    expect(() => store.editMessage("bob", user.id, "intrude")).toThrow(
      "not found",
    );
    expect(() => store.deleteMessage("bob", user.id)).toThrow("not found");
    expect(() => store.deleteConversation("bob", thread)).toThrow("not found");
    expect(store.message("alice", user.id)?.content).toContain("Secretword");
  });
  it("fences both inference and an already-leased memory job after deletion", () => {
    const { store, user, thread, entry } = setup();
    store.schedule("alice", true);
    const stale = store.claimJob()!;
    const { run } = store.begin(
      "alice",
      thread,
      randomUUID(),
      "Another question",
    );
    store.deleteMessage("alice", user.id);
    expect(
      store.finish("alice", run.id, "late answer", [], [], [], {}),
    ).toBeNull();
    expect(store.completeMemory(stale, [entry])).toBe(false);
    expect(store.history("alice", { query: "Secretword" })).toEqual([]);
    expect(store.memories("alice")).toEqual([]);
  });
  it("deletes conversation dependencies without deleting other owners or threads", () => {
    const { store, thread, user } = setup();
    const other = store.createConversation("bob");
    const keep = store.createConversation("alice");
    store.recordPass(
      "alice",
      store.begin("alice", thread, randomUUID(), "A research question").run.id,
      "response",
      { text: "Secretword" },
    );
    store.saveSearchLookup(
      "alice",
      "lookup",
      ["https://example.com"],
      new Date().toISOString(),
    );
    store.deleteConversation("alice", thread);
    expect(store.conversation("alice", thread)).toBeUndefined();
    expect(store.message("alice", user.id)).toBeNull();
    expect(store.memories("alice")).toEqual([]);
    expect(
      store.db
        .prepare("SELECT * FROM runs WHERE conversation_id=?")
        .all(thread),
    ).toEqual([]);
    expect(store.db.prepare("SELECT * FROM search_passes").all()).toEqual([]);
    expect(store.searchLookup("alice", "lookup")).toBeNull();
    expect(store.conversation("bob", other)).toBeTruthy();
    expect(store.conversation("alice", keep)).toBeTruthy();
  });
  it("rolls back transcript changes if cleanup cannot be queued", () => {
    const { store, user } = setup();
    store.db.exec("DROP TABLE cache_cleanup");
    expect(() => store.editMessage("alice", user.id, "replacement")).toThrow();
    expect(store.message("alice", user.id)?.content).toContain("Secretword");
    expect(store.memories("alice")).toHaveLength(1);
    expect(store.history("alice", { query: "Secretword" })).toHaveLength(1);
  });
  it("keeps user-edited memory through consolidation, with its source trail and version", () => {
    const { store, user } = setup();
    const memory = store.memories("alice")[0];
    const edited = store.editMemory(
      "alice",
      memory.id,
      "I now prefer detailed replies.",
    );
    expect(edited).toMatchObject({
      id: memory.id,
      userEdited: true,
      version: memory.version + 1,
    });
    expect(edited.sources[0].messageId).toBe(user.id);
    expect(store.excluded("alice")).toContain(user.id);
    store.schedule("alice", true);
    const job = store.claimJob()!;
    expect(store.completeMemory(job, [])).toBe(true);
    expect(store.memories("alice")).toEqual([edited]);
    store.forget("alice", memory.id);
    expect(store.memories("alice")).toEqual([]);
    expect(store.message("alice", user.id)).toBeTruthy();
  });
  it("retracts a manual override when its original source is removed", () => {
    const { store, user } = setup();
    store.editMemory("alice", store.memories("alice")[0].id, "new preference");
    store.deleteMessage("alice", user.id);
    expect(store.memories("alice")).toEqual([]);
  });
});
describe("provider-side vector cleanup", () => {
  it("upgrades legacy index jobs and records their old vector IDs idempotently", () => {
    const { store, user } = setup();
    store.db.exec("ALTER TABLE semantic_jobs DROP COLUMN generation");
    store.db
      .prepare(
        "UPDATE semantic_jobs SET state='done',index_key='legacy-config' WHERE message_id=?",
      )
      .run(user.id);
    store.db
      .prepare("DELETE FROM data_migrations WHERE name='vector-manifest-v1'")
      .run();
    initializeSemanticJobs(store.db);
    initializeSemanticJobs(store.db);
    expect(
      store.db
        .prepare("SELECT vector_id FROM vector_records WHERE message_id=?")
        .all(user.id),
    ).toEqual([{ vector_id: `${user.id}:0` }]);
    store.deleteMessage("alice", user.id);
    expect(store.db.prepare("SELECT ids FROM vector_cleanup").all()).toEqual([
      { ids: JSON.stringify([`${user.id}:0`]) },
    ]);
  });

  it("queues every recorded namespace and retries provider outages durably", async () => {
    const { store, user } = setup();
    for (const namespace of ["old-config", "new-config"])
      store.db
        .prepare("INSERT INTO vector_records VALUES(?,?,?,?,?)")
        .run(
          "alice",
          user.id,
          "https://index.example",
          namespace,
          `${user.id}:0`,
        );
    store.deleteMessage("alice", user.id);
    const deleted: unknown[] = [];
    const index: VectorIndex = {
      query: async () => [],
      upsert: async () => {},
      delete: async (ns, ids) => {
        deleted.push({ ns, ids });
      },
    };
    expect(
      await cleanupNextVectors(store, () => ({
        ...index,
        delete: async () => {
          throw new Error("offline");
        },
      })),
    ).toBe(false);
    expect(
      store.db.prepare("SELECT count(*) AS count FROM vector_cleanup").get(),
    ).toEqual({ count: 2 });
    while (
      (await cleanupNextVectors(store, () => index, Date.now() + 600000)) !==
      null
    ) {
      /* drain due jobs */
    }
    expect(deleted).toHaveLength(2);
    expect(store.db.prepare("SELECT * FROM vector_cleanup").all()).toEqual([]);
  });
  it("captures write intent before upsert and deletes even if the transcript is removed in flight", async () => {
    const { store, user } = setup();
    // Only index the source user message.
    store.db
      .prepare("DELETE FROM semantic_jobs WHERE message_id<>?")
      .run(user.id);
    const index: VectorIndex = {
      query: async () => [],
      delete: async () => {},
      upsert: async () => {
        expect(
          store.db
            .prepare("SELECT * FROM vector_records WHERE message_id=?")
            .all(user.id),
        ).toHaveLength(1);
        store.deleteMessage("alice", user.id);
      },
    };
    expect(
      await indexNextMessage(store, index, async () => ({
        vectors: [[1]],
        tokens: 1,
      })),
    ).toMatchObject({ indexed: false });
    expect(store.db.prepare("SELECT * FROM vector_cleanup").all()).toHaveLength(
      1,
    );
    expect(await cleanupNextVectors(store, () => index)).toBeNull(); // Wait for the old write lease.
    expect(
      await cleanupNextVectors(store, () => index, Date.now() + 61000),
    ).toBe(true);
    expect(
      hydrateMatches(store, "alice", [
        {
          id: "stale",
          score: 1,
          metadata: {
            messageId: user.id,
            fingerprint: fingerprint(user.content),
          },
        },
      ]),
    ).toEqual([]);
  });
  it("does not upsert a message deleted while embeddings are computed", async () => {
    const { store, user } = setup();
    store.db
      .prepare("DELETE FROM semantic_jobs WHERE message_id<>?")
      .run(user.id);
    let writes = 0;
    const index: VectorIndex = {
      query: async () => [],
      delete: async () => {},
      upsert: async () => {
        writes++;
      },
    };
    await indexNextMessage(store, index, async () => {
      store.deleteMessage("alice", user.id);
      return { vectors: [[1]], tokens: 1 };
    });
    expect(writes).toBe(0);
  });
  it("keeps restored text in a new vector generation while old cleanup jobs drain", async () => {
    const { store, user } = setup();
    store.db
      .prepare("DELETE FROM semantic_jobs WHERE message_id<>?")
      .run(user.id);
    const provider = new Map<string, unknown>();
    const index: VectorIndex = {
      query: async () => [],
      upsert: async (_ns, records) => {
        for (const record of records) provider.set(record.id, record);
      },
      delete: async (_ns, ids) => {
        for (const id of ids) provider.delete(id);
      },
    };
    const embed = async () => ({ vectors: [[1]], tokens: 1 });
    await indexNextMessage(store, index, embed);
    const originalIds = [...provider.keys()];
    store.editMessage("alice", user.id, "A temporary replacement");
    await indexNextMessage(store, index, embed);
    store.editMessage("alice", user.id, user.content);
    await indexNextMessage(store, index, embed);
    const finalIds = (
      store.db
        .prepare("SELECT vector_id FROM vector_records WHERE message_id=?")
        .all(user.id) as { vector_id: string }[]
    ).map((r) => r.vector_id);
    expect(finalIds).not.toEqual(originalIds);
    while (
      (await cleanupNextVectors(store, () => index, Date.now() + 120000)) !==
      null
    ) {
      /* drain old generations */
    }
    expect([...provider.keys()]).toEqual(finalIds);
  });
  it("reindexes edited text while fencing an old indexing lease", () => {
    const { store, user } = setup();
    store.db
      .prepare("DELETE FROM semantic_jobs WHERE message_id<>?")
      .run(user.id);
    const jobs = new SemanticJobs(store.db);
    const old = jobs.claim("v1")!;
    store.editMessage("alice", user.id, "New content");
    expect(jobs.complete(old)).toBe(false);
    expect(jobs.claim("v1")?.messageId).toBe(user.id);
  });
});
