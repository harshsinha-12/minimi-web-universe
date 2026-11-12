import type { EvidenceAudit } from "../ai/claim-audit";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { settings } from "../config";
import { queueVectorCleanup } from "../memory/vector-cleanup";
import { initializeSemanticJobs } from "../memory/index-jobs";
import type {
  Citation,
  Conversation,
  Memory,
  Message,
  Run,
  Source,
  Trace,
} from "../types";

type MessageRow = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  status: string;
  citations: string;
  sources: string;
  run_id: string | null;
};
type Owner = {
  id: string;
  revision: number;
  memory_revision: number;
  cursor: number;
};
export type Job = {
  owner: string;
  token: string;
  revision: number;
  memoryRevision: number;
  target: number;
};
const now = () => new Date().toISOString();
const memoryFingerprint = (text: string) =>
  `sha256:${createHash("sha256").update(text.toLowerCase().trim()).digest("hex")}`;
const mapMessage = (r: MessageRow): Message => ({
  id: r.id,
  conversationId: r.conversation_id,
  role: r.role,
  content: r.content,
  createdAt: r.created_at,
  status: r.status,
  citations: JSON.parse(r.citations),
  sources: JSON.parse(r.sources),
  runId: r.run_id,
});

export class Store {
  db: Database.Database;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS owners(id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, memory_revision INTEGER NOT NULL DEFAULT 0, cursor INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES owners(id), title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS conversations_owner ON conversations(owner,updated_at);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, owner TEXT NOT NULL, conversation_id TEXT NOT NULL REFERENCES conversations(id), request_id TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, trace TEXT NOT NULL DEFAULT '[]', metrics TEXT NOT NULL DEFAULT '{}', error TEXT, UNIQUE(owner,request_id));
      CREATE INDEX IF NOT EXISTS runs_active ON runs(owner,conversation_id,status);
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, owner TEXT NOT NULL, conversation_id TEXT NOT NULL REFERENCES conversations(id), role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL, citations TEXT NOT NULL DEFAULT '[]', sources TEXT NOT NULL DEFAULT '[]', run_id TEXT REFERENCES runs(id));
      CREATE INDEX IF NOT EXISTS messages_time ON messages(owner,created_at);
      CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id,created_at);
      CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(content,content='messages',content_rowid='rowid');
      CREATE TRIGGER IF NOT EXISTS message_insert AFTER INSERT ON messages BEGIN INSERT INTO message_fts(rowid,content) VALUES(new.rowid,new.content); END;
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, kind TEXT NOT NULL, message_id TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_jobs(owner TEXT PRIMARY KEY REFERENCES owners(id), state TEXT NOT NULL DEFAULT 'pending', due_at INTEGER NOT NULL, first_at INTEGER NOT NULL, token TEXT, lease_until INTEGER, attempts INTEGER NOT NULL DEFAULT 0, error TEXT);
      CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, sources TEXT NOT NULL, valid_until TEXT, created_at TEXT NOT NULL, version INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, job_token TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS memory_owner ON memories(owner,active);
      CREATE TABLE IF NOT EXISTS forgotten(owner TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(owner,fingerprint));
      CREATE TABLE IF NOT EXISTS memory_exclusions(owner TEXT NOT NULL, message_id TEXT NOT NULL, PRIMARY KEY(owner,message_id));
      CREATE TABLE IF NOT EXISTS search_passes(id TEXT PRIMARY KEY,owner TEXT NOT NULL,run_id TEXT NOT NULL REFERENCES runs(id),response_id TEXT NOT NULL,observed_at TEXT NOT NULL,artifact TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS page_observations(url TEXT PRIMARY KEY, etag TEXT, last_modified TEXT, text_hash TEXT NOT NULL, title TEXT NOT NULL, excerpt TEXT NOT NULL, fetched_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS search_lookups(owner TEXT NOT NULL, question_key TEXT NOT NULL, urls TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY(owner, question_key));
    `);
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS message_delete AFTER DELETE ON messages BEGIN INSERT INTO message_fts(message_fts,rowid,content) VALUES('delete',old.rowid,old.content); END;
      CREATE TRIGGER IF NOT EXISTS message_update AFTER UPDATE OF content ON messages BEGIN
        INSERT INTO message_fts(message_fts,rowid,content) VALUES('delete',old.rowid,old.content);
        INSERT INTO message_fts(rowid,content) VALUES(new.rowid,new.content);
      END;
      CREATE TABLE IF NOT EXISTS evidence_audits(message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,owner TEXT NOT NULL,audit TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS claim_support(id TEXT PRIMARY KEY,message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,owner TEXT NOT NULL,record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS comparisons(id TEXT PRIMARY KEY,message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,owner TEXT NOT NULL,record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_overrides(id TEXT PRIMARY KEY,owner TEXT NOT NULL,kind TEXT NOT NULL,content TEXT NOT NULL,sources TEXT NOT NULL,created_at TEXT NOT NULL,version INTEGER NOT NULL);
    `);
    initializeSemanticJobs(this.db);
    // Legacy tombstones held plaintext. Keep only opaque fingerprints, including after source deletion.
    this.db.transaction(() => {
      const rows = this.db
        .prepare("SELECT owner,fingerprint,created_at FROM forgotten")
        .all() as { owner: string; fingerprint: string; created_at: string }[];
      for (const row of rows)
        if (!/^sha256:[a-f0-9]{64}$/.test(row.fingerprint)) {
          this.db
            .prepare("INSERT OR IGNORE INTO forgotten VALUES(?,?,?)")
            .run(row.owner, memoryFingerprint(row.fingerprint), row.created_at);
          this.db
            .prepare("DELETE FROM forgotten WHERE owner=? AND fingerprint=?")
            .run(row.owner, row.fingerprint);
        }
    })();
  }
  close() {
    this.db.close();
  }
  owner(id: string): Owner {
    this.db.prepare("INSERT OR IGNORE INTO owners(id) VALUES(?)").run(id);
    return this.db.prepare("SELECT * FROM owners WHERE id=?").get(id) as Owner;
  }
  conversations(owner: string): Conversation[] {
    return (
      this.db
        .prepare(
          "SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id) AS count FROM conversations c WHERE owner=? ORDER BY updated_at DESC",
        )
        .all(owner) as {
        id: string;
        title: string;
        updated_at: string;
        count: number;
      }[]
    ).map((r) => ({
      id: r.id,
      title: r.title,
      updatedAt: r.updated_at,
      messageCount: r.count,
    }));
  }
  conversation(owner: string, id: string) {
    return this.db
      .prepare("SELECT * FROM conversations WHERE owner=? AND id=?")
      .get(owner, id);
  }
  createConversation(owner: string, title = "A new thread") {
    this.owner(owner);
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO conversations VALUES(?,?,?,?,?)")
      .run(id, owner, title, now(), now());
    return id;
  }
  messages(owner: string, conversationId: string): Message[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM messages WHERE owner=? AND conversation_id=? ORDER BY created_at,rowid",
        )
        .all(owner, conversationId) as MessageRow[]
    ).map((r) => this.withEvidence(owner, mapMessage(r)));
  }
  message(owner: string, id: string): Message | null {
    const row = this.db
      .prepare("SELECT * FROM messages WHERE owner=? AND id=?")
      .get(owner, id) as MessageRow | undefined;
    return row ? this.withEvidence(owner, mapMessage(row)) : null;
  }
  private withEvidence(owner: string, message: Message): Message {
    const row = this.db
      .prepare(
        "SELECT audit FROM evidence_audits WHERE owner=? AND message_id=?",
      )
      .get(owner, message.id) as { audit: string } | undefined;
    return row ? { ...message, evidence: JSON.parse(row.audit) } : message;
  }
  history(
    owner: string,
    options: {
      from?: string;
      to?: string;
      query?: string;
      limit?: number;
    } = {},
  ): Message[] {
    const limit = Math.min(options.limit ?? 100, 400);
    if (options.from && options.to)
      return (
        this.db
          .prepare(
            "SELECT * FROM messages WHERE owner=? AND created_at>=? AND created_at<? ORDER BY created_at,rowid LIMIT ?",
          )
          .all(owner, options.from, options.to, limit) as MessageRow[]
      ).map(mapMessage);
    const words = (options.query ?? "")
      .match(/[\p{L}\p{N}]{3,}/gu)
      ?.filter(
        (w) =>
          !/^(what|when|have|with|that|this|asked|about|today|please|since|changed|pricing|last|from|were|does|which|they|them|your|again)$/i.test(
            w,
          ),
      )
      .slice(0, 12);
    if (words?.length) {
      const match = words.map((w) => `"${w}"`).join(" OR ");
      return (
        this.db
          .prepare(
            "SELECT m.* FROM message_fts f JOIN messages m ON m.rowid=f.rowid WHERE message_fts MATCH ? AND m.owner=? ORDER BY bm25(message_fts) LIMIT ?",
          )
          .all(match, owner, limit) as MessageRow[]
      ).map(mapMessage);
    }
    return (
      this.db
        .prepare(
          "SELECT * FROM messages WHERE owner=? ORDER BY created_at DESC,rowid DESC LIMIT ?",
        )
        .all(owner, limit) as MessageRow[]
    )
      .map(mapMessage)
      .reverse();
  }
  begin(
    owner: string,
    conversationId: string,
    requestId: string,
    content: string,
    at = now(),
  ): { run: Run; duplicate: boolean } {
    return this.db.transaction(() => {
      if (!this.conversation(owner, conversationId))
        throw new Error("Conversation not found");
      const existing = this.db
        .prepare("SELECT id FROM runs WHERE owner=? AND request_id=?")
        .get(owner, requestId) as { id: string } | undefined;
      if (existing)
        return { run: this.run(owner, existing.id)!, duplicate: true };
      const rate = this.db
        .prepare(
          "SELECT COUNT(*) AS count FROM runs WHERE owner=? AND started_at>?",
        )
        .get(owner, new Date(Date.now() - 60000).toISOString()) as {
        count: number;
      };
      if (rate.count >= 15)
        throw new Error("Please wait a moment before sending more messages.");
      this.db
        .prepare(
          "UPDATE runs SET status='interrupted',finished_at=? WHERE owner=? AND status='running' AND started_at<?",
        )
        .run(
          now(),
          owner,
          new Date(Date.now() - settings.deadline - 30000).toISOString(),
        );
      if (
        this.db
          .prepare("SELECT id FROM runs WHERE owner=? AND status='running'")
          .get(owner)
      )
        throw new Error(
          "Another answer is running. Wait for it or stop it first.",
        );
      const id = randomUUID();
      this.db
        .prepare(
          "INSERT INTO runs(id,owner,conversation_id,request_id,status,started_at) VALUES(?,?,?,?,?,?)",
        )
        .run(id, owner, conversationId, requestId, "running", at);
      const messageId = randomUUID();
      this.db
        .prepare(
          "INSERT INTO messages(id,owner,conversation_id,role,content,created_at,status,run_id) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          messageId,
          owner,
          conversationId,
          "user",
          content,
          at,
          "completed",
          id,
        );
      this.db
        .prepare(
          "INSERT INTO events(owner,kind,message_id,created_at) VALUES(?,?,?,?)",
        )
        .run(owner, "message", messageId, at);
      this.db
        .prepare("UPDATE owners SET revision=revision+1 WHERE id=?")
        .run(owner);
      this.db
        .prepare(
          "UPDATE conversations SET title=CASE WHEN title='A new thread' THEN ? ELSE title END,updated_at=? WHERE id=?",
        )
        .run(content.slice(0, 70), at, conversationId);
      return { run: this.run(owner, id)!, duplicate: false };
    })();
  }
  run(owner: string, id: string): Run | null {
    const r = this.db
      .prepare("SELECT * FROM runs WHERE owner=? AND id=?")
      .get(owner, id) as
      | {
          id: string;
          conversation_id: string;
          status: string;
          trace: string;
          metrics: string;
          started_at: string;
          error: string | null;
        }
      | undefined;
    return r
      ? {
          id: r.id,
          conversationId: r.conversation_id,
          status: r.status,
          trace: JSON.parse(r.trace),
          metrics: JSON.parse(r.metrics),
          startedAt: r.started_at,
          error: r.error,
        }
      : null;
  }
  recordPass(
    owner: string,
    runId: string,
    responseId: string,
    artifact: unknown,
  ) {
    if (this.run(owner, runId)?.status !== "running")
      throw new Error("Conversation data changed; research stopped");
    this.db
      .prepare("INSERT INTO search_passes VALUES(?,?,?,?,?,?)")
      .run(
        randomUUID(),
        owner,
        runId,
        responseId,
        now(),
        JSON.stringify(artifact),
      );
  }
  finish(
    owner: string,
    runId: string,
    answer: string,
    citations: Citation[],
    sources: Source[],
    trace: Trace[],
    metrics: Record<string, unknown>,
    status = "completed",
    error: string | null = null,
    evidence?: EvidenceAudit,
  ): Message | null {
    return this.db.transaction(() => {
      const run = this.run(owner, runId);
      if (!run || run.status !== "running") return null;
      const id = randomUUID();
      const at = now();
      this.db
        .prepare(
          "UPDATE runs SET status=?,finished_at=?,trace=?,metrics=?,error=? WHERE id=? AND owner=? AND status='running'",
        )
        .run(
          status,
          at,
          JSON.stringify(trace),
          JSON.stringify(metrics),
          error,
          runId,
          owner,
        );
      this.db
        .prepare("INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(
          id,
          owner,
          run.conversationId,
          "assistant",
          answer,
          at,
          status,
          JSON.stringify(citations),
          JSON.stringify(sources),
          runId,
        );
      this.db
        .prepare(
          "INSERT INTO events(owner,kind,message_id,created_at) VALUES(?,?,?,?)",
        )
        .run(owner, "message", id, at);
      this.db
        .prepare("UPDATE owners SET revision=revision+1 WHERE id=?")
        .run(owner);
      this.db
        .prepare("UPDATE conversations SET updated_at=? WHERE id=?")
        .run(at, run.conversationId);
      if (evidence) {
        this.db
          .prepare("INSERT INTO evidence_audits VALUES(?,?,?)")
          .run(id, owner, JSON.stringify(evidence));
        for (const claim of evidence.claims)
          this.db
            .prepare("INSERT INTO claim_support VALUES(?,?,?,?)")
            .run(claim.id, id, owner, JSON.stringify(claim));
        for (const comparison of evidence.comparisons)
          this.db
            .prepare("INSERT INTO comparisons VALUES(?,?,?,?)")
            .run(comparison.id, id, owner, JSON.stringify(comparison));
      }
      if (status === "completed") this.schedule(owner);
      return this.messages(owner, run.conversationId).find((m) => m.id === id)!;
    })();
  }
  schedule(owner: string, immediate = false) {
    const time = Date.now();
    this.db
      .prepare(
        `INSERT INTO memory_jobs(owner,due_at,first_at) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET due_at=MIN(?,memory_jobs.first_at+?),attempts=CASE WHEN state='failed' THEN 0 ELSE attempts END,state=CASE WHEN state='running' THEN state ELSE 'pending' END`,
      )
      .run(
        owner,
        time + (immediate ? 0 : settings.memoryIdle),
        time,
        time + (immediate ? 0 : settings.memoryIdle),
        settings.memoryMaxWait,
      );
  }
  memories(owner: string): Memory[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM memories WHERE owner=? AND active=1 AND (valid_until IS NULL OR valid_until>?) ORDER BY created_at DESC",
      )
      .all(owner, now()) as {
      id: string;
      kind: string;
      content: string;
      sources: string;
      valid_until: string | null;
      created_at: string;
      version: number;
    }[];
    return rows
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        text: r.content,
        sources: JSON.parse(r.sources),
        validUntil: r.valid_until,
        createdAt: r.created_at,
        version: r.version,
      }))
      .concat(
        (
          this.db
            .prepare("SELECT * FROM memory_overrides WHERE owner=?")
            .all(owner) as {
            id: string;
            kind: string;
            content: string;
            sources: string;
            created_at: string;
            version: number;
          }[]
        ).map((r) => ({
          id: r.id,
          kind: r.kind,
          text: r.content,
          sources: JSON.parse(r.sources),
          validUntil: null,
          createdAt: r.created_at,
          version: r.version,
          userEdited: true,
        })),
      );
  }
  editMemory(owner: string, id: string, text: string) {
    return this.db.transaction(() => {
      const memory = this.memories(owner).find((m) => m.id === id);
      if (!memory) throw new Error("Memory not found");
      this.forget(owner, id);
      this.db
        .prepare("INSERT INTO memory_overrides VALUES(?,?,?,?,?,?,?)")
        .run(
          id,
          owner,
          memory.kind,
          text,
          JSON.stringify(memory.sources),
          now(),
          memory.version + 1,
        );
      return this.memories(owner).find((m) => m.id === id)!;
    })();
  }
  forget(owner: string, id: string) {
    this.db.transaction(() => {
      const row = this.db
        .prepare(
          "SELECT content,sources FROM memories WHERE owner=? AND id=? AND active=1",
        )
        .get(owner, id) as { content: string; sources: string } | undefined;
      const override = this.db
        .prepare(
          "SELECT content,sources FROM memory_overrides WHERE owner=? AND id=?",
        )
        .get(owner, id) as { content: string; sources: string } | undefined;
      const target = override ?? row;
      if (!target) throw new Error("Memory not found");
      this.db
        .prepare("DELETE FROM memory_overrides WHERE owner=? AND id=?")
        .run(owner, id);
      this.db
        .prepare("INSERT OR IGNORE INTO forgotten VALUES(?,?,?)")
        .run(owner, memoryFingerprint(target.content), now());
      for (const source of JSON.parse(target.sources) as Memory["sources"])
        this.db
          .prepare("INSERT OR IGNORE INTO memory_exclusions VALUES(?,?)")
          .run(owner, source.messageId);
      const excluded = new Set(this.excluded(owner));
      for (const memory of this.memories(owner)) {
        if (memory.sources.some((source) => excluded.has(source.messageId)))
          this.db
            .prepare("UPDATE memories SET active=0 WHERE id=? AND owner=?")
            .run(memory.id, owner);
      }
      this.db
        .prepare("INSERT INTO events(owner,kind,created_at) VALUES(?,?,?)")
        .run(owner, "memory_forget", now());
      this.db
        .prepare(
          "UPDATE owners SET revision=revision+1,memory_revision=memory_revision+1 WHERE id=?",
        )
        .run(owner);
      this.db
        .prepare("INSERT OR IGNORE INTO cache_cleanup VALUES(?)")
        .run(owner);
      this.db
        .prepare(
          "UPDATE runs SET status='interrupted',finished_at=? WHERE owner=? AND status='running'",
        )
        .run(now(), owner);
      this.schedule(owner, true);
    })();
  }
  // Mutations fence every owner run because it may have read the changed message across threads.
  private invalidateData(owner: string, ids: string[]) {
    for (const id of ids) {
      queueVectorCleanup(this.db, owner, id);
      for (const table of ["memories", "memory_overrides"]) {
        const rows = this.db
          .prepare(`SELECT id,sources FROM ${table} WHERE owner=?`)
          .all(owner) as { id: string; sources: string }[];
        for (const row of rows)
          if (
            (JSON.parse(row.sources) as Memory["sources"]).some(
              (s) => s.messageId === id,
            )
          )
            this.db
              .prepare(`DELETE FROM ${table} WHERE owner=? AND id=?`)
              .run(owner, row.id);
      }
      this.db
        .prepare("DELETE FROM memory_exclusions WHERE owner=? AND message_id=?")
        .run(owner, id);
      this.db
        .prepare("DELETE FROM events WHERE owner=? AND message_id=?")
        .run(owner, id);
      this.db
        .prepare(
          "INSERT INTO events(owner,kind,message_id,created_at) VALUES(?,?,?,?)",
        )
        .run(owner, "transcript_changed", id, now());
    }
    this.db
      .prepare(
        "UPDATE runs SET status='interrupted',finished_at=?,trace='[]',metrics='{}',error='Conversation data changed' WHERE owner=? AND status='running'",
      )
      .run(now(), owner);
    // Clear artifacts that may contain a copied baseline from any of this owner's threads.
    this.db.prepare("DELETE FROM search_passes WHERE owner=?").run(owner);
    // Audits may quote the modified baseline across conversations.
    for (const table of ["evidence_audits", "claim_support", "comparisons"])
      this.db.prepare(`DELETE FROM ${table} WHERE owner=?`).run(owner);
    this.db.prepare("DELETE FROM search_lookups WHERE owner=?").run(owner);
    this.db.prepare("INSERT OR IGNORE INTO cache_cleanup VALUES(?)").run(owner);
    this.db
      .prepare(
        "UPDATE owners SET revision=revision+1,memory_revision=memory_revision+1 WHERE id=?",
      )
      .run(owner);
    this.schedule(owner, true);
  }
  editMessage(owner: string, id: string, content: string) {
    return this.db.transaction(() => {
      const message = this.message(owner, id);
      if (!message) throw new Error("Message not found");
      this.invalidateData(owner, [id]);
      this.db
        .prepare(
          "UPDATE messages SET content=?,citations='[]',sources='[]' WHERE owner=? AND id=?",
        )
        .run(content, owner, id);
      this.db
        .prepare(
          "UPDATE semantic_jobs SET state='pending',token=NULL,lease_until=NULL,attempts=0,due_at=0,generation=? WHERE owner=? AND message_id=?",
        )
        .run(randomUUID(), owner, id);
      this.db
        .prepare(
          "UPDATE runs SET trace='[]',metrics='{}',error=NULL WHERE owner=? AND id=?",
        )
        .run(owner, message.runId);
      this.db
        .prepare(
          "UPDATE conversations SET title=CASE WHEN ?='user' AND ?=(SELECT id FROM messages WHERE conversation_id=? AND role='user' ORDER BY created_at,rowid LIMIT 1) THEN ? ELSE title END,updated_at=? WHERE owner=? AND id=?",
        )
        .run(
          message.role,
          id,
          message.conversationId,
          content.slice(0, 70),
          now(),
          owner,
          message.conversationId,
        );
      return this.message(owner, id)!;
    })();
  }
  deleteMessage(owner: string, id: string) {
    this.db.transaction(() => {
      const message = this.message(owner, id);
      if (!message) throw new Error("Message not found");
      this.invalidateData(owner, [id]);
      this.db
        .prepare("DELETE FROM events WHERE owner=? AND message_id=?")
        .run(owner, id);
      this.db
        .prepare("DELETE FROM messages WHERE owner=? AND id=?")
        .run(owner, id);
      this.db
        .prepare(
          "DELETE FROM runs WHERE owner=? AND id=? AND NOT EXISTS(SELECT 1 FROM messages WHERE run_id=?)",
        )
        .run(owner, message.runId, message.runId);
      this.db
        .prepare(
          "UPDATE runs SET trace='[]',metrics='{}',error=NULL WHERE owner=? AND id=?",
        )
        .run(owner, message.runId);
      this.db
        .prepare(
          "UPDATE conversations SET title=COALESCE((SELECT substr(content,1,70) FROM messages WHERE conversation_id=? AND role='user' ORDER BY created_at,rowid LIMIT 1),'A new thread'),updated_at=? WHERE owner=? AND id=?",
        )
        .run(message.conversationId, now(), owner, message.conversationId);
    })();
  }
  deleteConversation(owner: string, id: string) {
    this.db.transaction(() => {
      if (!this.conversation(owner, id))
        throw new Error("Conversation not found");
      const ids = this.messages(owner, id).map((m) => m.id);
      this.invalidateData(owner, ids);
      for (const messageId of ids)
        this.db
          .prepare("DELETE FROM events WHERE owner=? AND message_id=?")
          .run(owner, messageId);
      this.db
        .prepare("DELETE FROM messages WHERE owner=? AND conversation_id=?")
        .run(owner, id);
      this.db
        .prepare("DELETE FROM runs WHERE owner=? AND conversation_id=?")
        .run(owner, id);
      this.db
        .prepare("DELETE FROM conversations WHERE owner=? AND id=?")
        .run(owner, id);
    })();
  }
  claimJob(): Job | null {
    return this.db.transaction(() => {
      const time = Date.now();
      const row = this.db
        .prepare(
          "SELECT * FROM memory_jobs WHERE due_at<=? AND (state='pending' OR (state='running' AND lease_until<?)) ORDER BY first_at LIMIT 1",
        )
        .get(time, time) as { owner: string } | undefined;
      if (!row) return null;
      const token = randomUUID();
      const o = this.owner(row.owner);
      const batch = this.db
        .prepare(
          "SELECT e.id,COALESCE(length(m.content),0) AS size FROM events e LEFT JOIN messages m ON m.id=e.message_id WHERE e.owner=? AND e.id>? ORDER BY e.id LIMIT 120",
        )
        .all(row.owner, o.cursor) as { id: number; size: number }[];
      let characters = 0;
      const bounded: typeof batch = [];
      for (const event of batch) {
        if (bounded.length && characters + event.size > 40000) break;
        bounded.push(event);
        characters += event.size;
      }
      this.db
        .prepare(
          "UPDATE memory_jobs SET state='running',token=?,lease_until=?,attempts=attempts+1 WHERE owner=?",
        )
        .run(token, time + 90000, row.owner);
      return {
        owner: row.owner,
        token,
        revision: o.revision,
        memoryRevision: o.memory_revision,
        target: bounded.at(-1)?.id ?? o.cursor,
      };
    })();
  }
  completeMemory(
    job: Job,
    entries: Omit<Memory, "id" | "version" | "createdAt">[],
  ): boolean {
    return this.db.transaction(() => {
      const lease = this.db
        .prepare("SELECT token,lease_until FROM memory_jobs WHERE owner=?")
        .get(job.owner) as { token: string; lease_until: number } | undefined;
      const state = this.owner(job.owner);
      if (
        lease?.token !== job.token ||
        lease.lease_until < Date.now() ||
        state.revision !== job.revision ||
        state.memory_revision !== job.memoryRevision
      )
        return false;
      const forgotten = (
        this.db
          .prepare("SELECT fingerprint FROM forgotten WHERE owner=?")
          .all(job.owner) as { fingerprint: string }[]
      ).map((r) => r.fingerprint);
      const excluded = new Set(this.excluded(job.owner));
      const valid = entries.filter(
        (e) =>
          !forgotten.includes(memoryFingerprint(e.text)) &&
          e.sources.length > 0 &&
          e.sources.every((s) => {
            const m = this.db
              .prepare(
                "SELECT role,content FROM messages WHERE owner=? AND id=? AND status='completed'",
              )
              .get(job.owner, s.messageId) as
              { role: string; content: string } | undefined;
            return (
              !excluded.has(s.messageId) &&
              m?.role === "user" &&
              m.content.includes(s.quote) &&
              s.quote.length >= 4
            );
          }),
      );
      if (valid.length !== entries.length) return false;
      this.db
        .prepare("UPDATE memories SET active=0 WHERE owner=?")
        .run(job.owner);
      const version = state.memory_revision + 1;
      for (const e of valid)
        this.db
          .prepare("INSERT INTO memories VALUES(?,?,?,?,?,?,?,?,?,?)")
          .run(
            randomUUID(),
            job.owner,
            e.kind,
            e.text,
            JSON.stringify(e.sources),
            e.validUntil,
            now(),
            version,
            1,
            job.token,
          );
      this.db
        .prepare("UPDATE owners SET memory_revision=?,cursor=? WHERE id=?")
        .run(version, job.target, job.owner);
      this.db
        .prepare("DELETE FROM memory_jobs WHERE owner=? AND token=?")
        .run(job.owner, job.token);
      if (
        this.db
          .prepare("SELECT id FROM events WHERE owner=? AND id>? LIMIT 1")
          .get(job.owner, job.target)
      )
        this.schedule(job.owner, true);
      return true;
    })();
  }
  retryJob(job: Job, reason: string) {
    const row = this.db
      .prepare("SELECT attempts FROM memory_jobs WHERE owner=? AND token=?")
      .get(job.owner, job.token) as { attempts: number } | undefined;
    if (!row) return;
    const delay = Math.min(300000, 30000 * 2 ** Math.min(row.attempts - 1, 4));
    this.db
      .prepare(
        "UPDATE memory_jobs SET state=?,due_at=?,token=NULL,error=? WHERE owner=? AND token=?",
      )
      .run(
        row.attempts >= 5 ? "failed" : "pending",
        Date.now() + delay,
        reason.slice(0, 180),
        job.owner,
        job.token,
      );
  }
  forgotten(owner: string) {
    return (
      this.db
        .prepare("SELECT fingerprint FROM forgotten WHERE owner=?")
        .all(owner) as { fingerprint: string }[]
    ).map((r) => r.fingerprint);
  }
  excluded(owner: string) {
    return (
      this.db
        .prepare("SELECT message_id FROM memory_exclusions WHERE owner=?")
        .all(owner) as { message_id: string }[]
    ).map((r) => r.message_id);
  }
  jobMessages(job: Job): Message[] {
    const o = this.owner(job.owner);
    const fresh = (
      this.db
        .prepare(
          "SELECT m.* FROM events e JOIN messages m ON m.id=e.message_id WHERE e.owner=? AND e.id>? AND e.id<=? AND m.status='completed' ORDER BY e.id",
        )
        .all(job.owner, o.cursor, job.target) as MessageRow[]
    ).map(mapMessage);
    const all = new Map(fresh.map((m) => [m.id, m]));
    for (const memory of this.memories(job.owner))
      for (const source of memory.sources) {
        const m = this.db
          .prepare("SELECT * FROM messages WHERE owner=? AND id=?")
          .get(job.owner, source.messageId) as MessageRow | undefined;
        if (m && !fresh.some((f) => f.id === m.id)) {
          const existing = all.get(m.id);
          all.set(m.id, {
            ...mapMessage(m),
            content: existing
              ? `${existing.content}\n${source.quote}`
              : source.quote,
          });
        }
      }
    const excluded = new Set(this.excluded(job.owner));
    return [...all.values()]
      .filter((m) => m.role === "user" && !excluded.has(m.id))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  savePageObservation(page: {
    url: string;
    etag: string | null;
    lastModified: string | null;
    textHash: string;
    title: string;
    excerpt: string;
    fetchedAt: string;
  }) {
    this.db
      .prepare(
        `INSERT INTO page_observations(url,etag,last_modified,text_hash,title,excerpt,fetched_at) VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(url) DO UPDATE SET etag=excluded.etag,last_modified=excluded.last_modified,text_hash=excluded.text_hash,title=excluded.title,excerpt=excluded.excerpt,fetched_at=excluded.fetched_at`,
      )
      .run(
        page.url,
        page.etag,
        page.lastModified,
        page.textHash,
        page.title,
        page.excerpt,
        page.fetchedAt,
      );
  }
  pageObservation(url: string) {
    const row = this.db
      .prepare("SELECT * FROM page_observations WHERE url=?")
      .get(url) as
      | {
          url: string;
          etag: string | null;
          last_modified: string | null;
          text_hash: string;
          title: string;
          excerpt: string;
          fetched_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      url: row.url,
      etag: row.etag,
      lastModified: row.last_modified,
      textHash: row.text_hash,
      title: row.title,
      excerpt: row.excerpt,
      fetchedAt: row.fetched_at,
    };
  }
  saveSearchLookup(
    owner: string,
    questionKey: string,
    urls: string[],
    savedAt: string,
  ) {
    this.owner(owner);
    this.db
      .prepare(
        `INSERT INTO search_lookups(owner,question_key,urls,saved_at) VALUES(?,?,?,?)
         ON CONFLICT(owner,question_key) DO UPDATE SET urls=excluded.urls,saved_at=excluded.saved_at`,
      )
      .run(owner, questionKey, JSON.stringify(urls), savedAt);
  }
  searchLookup(owner: string, questionKey: string) {
    const row = this.db
      .prepare(
        "SELECT urls,saved_at FROM search_lookups WHERE owner=? AND question_key=?",
      )
      .get(owner, questionKey) as
      { urls: string; saved_at: string } | undefined;
    if (!row) return null;
    try {
      const urls = JSON.parse(row.urls);
      if (!Array.isArray(urls) || urls.some((url) => typeof url !== "string"))
        return null;
      return { urls, savedAt: row.saved_at };
    } catch {
      return null;
    }
  }
}
const scope = globalThis as typeof globalThis & {
  minimiStore?: Store;
  minimiStoreVersion?: number;
};
export function getStore() {
  if (
    !scope.minimiStore ||
    !(scope.minimiStore instanceof Store) ||
    scope.minimiStoreVersion !== 4
  ) {
    scope.minimiStore?.close();
    scope.minimiStore = new Store(settings.database);
    scope.minimiStoreVersion = 4;
  }
  return scope.minimiStore;
}
