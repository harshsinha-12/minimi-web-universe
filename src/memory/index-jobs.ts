import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  initializeVectorCleanup,
  migrateLegacyVectors,
} from "./vector-cleanup";

export type IndexJob = {
  owner: string;
  messageId: string;
  token: string;
  indexKey: string;
  generation: string;
};
export function initializeSemanticJobs(db: Database.Database) {
  initializeVectorCleanup(db);
  // The insert trigger commits the outbox entry in the same transaction as the message.
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE name='semantic_jobs'")
    .get();
  db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_jobs(
      message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      owner TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', due_at INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0, token TEXT, lease_until INTEGER, index_key TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS semantic_due ON semantic_jobs(state,due_at);
    CREATE TRIGGER IF NOT EXISTS semantic_enqueue AFTER INSERT ON messages WHEN new.status='completed'
    BEGIN INSERT OR IGNORE INTO semantic_jobs(message_id,owner) VALUES(new.id,new.owner); END;
  `);
  if (!exists)
    db.exec(
      "INSERT OR IGNORE INTO semantic_jobs(message_id,owner) SELECT id,owner FROM messages WHERE status='completed'",
    );
  const columns = db.pragma("table_info(semantic_jobs)") as { name: string }[];
  if (!columns.some((c) => c.name === "generation"))
    db.exec(
      "ALTER TABLE semantic_jobs ADD COLUMN generation TEXT NOT NULL DEFAULT ''",
    );
  migrateLegacyVectors(db);
}

export class SemanticJobs {
  constructor(private db: Database.Database) {}
  claim(indexKey: string, time = Date.now()): IndexJob | null {
    return this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT message_id,owner,index_key,generation FROM semantic_jobs
        WHERE (state='pending' AND due_at<=?) OR (state='running' AND lease_until<?) OR (index_key<>? AND state IN ('done','failed'))
        ORDER BY due_at,message_id LIMIT 1`,
        )
        .get(time, time, indexKey) as
        | {
            message_id: string;
            owner: string;
            index_key: string;
            generation: string;
          }
        | undefined;
      if (!row) return null;
      const token = randomUUID();
      const generation = row.generation || randomUUID();
      this.db
        .prepare(
          `UPDATE semantic_jobs SET state='running',token=?,lease_until=?,generation=?,
        attempts=CASE WHEN index_key=? THEN attempts+1 ELSE 1 END,index_key=? WHERE message_id=?`,
        )
        .run(
          token,
          time + 60000,
          generation,
          indexKey,
          indexKey,
          row.message_id,
        );
      return {
        owner: row.owner,
        messageId: row.message_id,
        token,
        indexKey,
        generation,
      };
    })();
  }
  complete(job: IndexJob, time = Date.now()) {
    return (
      this.db
        .prepare(
          "UPDATE semantic_jobs SET state='done',token=NULL,lease_until=NULL WHERE message_id=? AND owner=? AND token=? AND index_key=? AND state='running' AND lease_until>?",
        )
        .run(job.messageId, job.owner, job.token, job.indexKey, time)
        .changes === 1
    );
  }
  retry(job: IndexJob, time = Date.now()) {
    this.db
      .prepare(
        `UPDATE semantic_jobs SET state=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,
      due_at=?+MIN(300000,30000*attempts),token=NULL,lease_until=NULL WHERE message_id=? AND owner=? AND token=? AND index_key=? AND state='running'`,
      )
      .run(time, job.messageId, job.owner, job.token, job.indexKey);
  }
}
