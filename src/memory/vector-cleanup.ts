import type Database from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import {
  pineconeIndex,
  type VectorIndex,
} from "../ai/__tools__/tool__pinecone";
import { settings } from "../config";
import type { Store } from "../db/store";
export function initializeVectorCleanup(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vector_records(owner TEXT NOT NULL,message_id TEXT NOT NULL,host TEXT NOT NULL,namespace TEXT NOT NULL,vector_id TEXT NOT NULL,PRIMARY KEY(host,namespace,vector_id));
    CREATE TABLE IF NOT EXISTS vector_cleanup(id TEXT PRIMARY KEY,owner TEXT NOT NULL,host TEXT NOT NULL,namespace TEXT NOT NULL,ids TEXT NOT NULL,due_at INTEGER NOT NULL,token TEXT,lease_until INTEGER,attempts INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS cache_cleanup(owner TEXT PRIMARY KEY);
  `);
}
export function queueVectorCleanup(
  db: Database.Database,
  owner: string,
  messageId: string,
) {
  const records = db
    .prepare(
      "SELECT host,namespace,vector_id FROM vector_records WHERE owner=? AND message_id=?",
    )
    .all(owner, messageId) as {
    host: string;
    namespace: string;
    vector_id: string;
  }[];
  const job = db
    .prepare(
      "SELECT lease_until FROM semantic_jobs WHERE owner=? AND message_id=? AND state='running'",
    )
    .get(owner, messageId) as { lease_until: number } | undefined;
  const due = Math.max(Date.now(), job?.lease_until ?? 0);
  const groups = new Map<string, typeof records>();
  for (const row of records) {
    const key = JSON.stringify([row.host, row.namespace]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const rows of groups.values())
    db.prepare(
      "INSERT INTO vector_cleanup(id,owner,host,namespace,ids,due_at) VALUES(?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      owner,
      rows[0].host,
      rows[0].namespace,
      JSON.stringify(rows.map((r) => r.vector_id)),
      due,
    );
  db.prepare("DELETE FROM vector_records WHERE owner=? AND message_id=?").run(
    owner,
    messageId,
  );
}
export async function cleanupNextVectors(
  store: Store,
  adapter: (host: string) => VectorIndex = pineconeIndex,
  time = Date.now(),
) {
  const job = store.db.transaction(() => {
    const row = store.db
      .prepare(
        "SELECT * FROM vector_cleanup WHERE due_at<=? AND (token IS NULL OR lease_until<?) ORDER BY due_at LIMIT 1",
      )
      .get(time, time) as
      { id: string; host: string; namespace: string; ids: string } | undefined;
    if (!row) return null;
    const token = randomUUID();
    store.db
      .prepare(
        "UPDATE vector_cleanup SET token=?,lease_until=?,attempts=attempts+1 WHERE id=?",
      )
      .run(token, time + 60000, row.id);
    return { ...row, token };
  })();
  if (!job) return null;
  try {
    await adapter(job.host).delete(
      job.namespace,
      JSON.parse(job.ids),
      AbortSignal.timeout(15000),
    );
    store.db
      .prepare("DELETE FROM vector_cleanup WHERE id=? AND token=?")
      .run(job.id, job.token);
    return true;
  } catch {
    store.db
      .prepare(
        "UPDATE vector_cleanup SET token=NULL,lease_until=NULL,due_at=?+MIN(300000,30000*attempts) WHERE id=? AND token=?",
      )
      .run(time, job.id, job.token);
    return false;
  }
}

// Upgrade the previous deterministic message:chunk IDs into the deletion manifest.
export function migrateLegacyVectors(db: Database.Database) {
  db.exec("CREATE TABLE IF NOT EXISTS data_migrations(name TEXT PRIMARY KEY)");
  if (
    db
      .prepare(
        "SELECT name FROM data_migrations WHERE name='vector-manifest-v1'",
      )
      .get()
  )
    return;
  db.transaction(() => {
    const rows = db
      .prepare(
        "SELECT m.id,m.owner,m.content,j.index_key FROM messages m JOIN semantic_jobs j ON j.message_id=m.id WHERE j.index_key<>''",
      )
      .all() as {
      id: string;
      owner: string;
      content: string;
      index_key: string;
    }[];
    for (const row of rows) {
      const namespace = `${settings.pineconePrefix}-${row.index_key}-${createHash("sha256").update(row.owner).digest("hex").slice(0, 32)}`;
      const count =
        Math.max(0, Math.ceil((Array.from(row.content).length - 2000) / 1700)) +
        1;
      for (let i = 0; i < Math.min(count, 64); i++)
        db.prepare(
          "INSERT OR IGNORE INTO vector_records VALUES(?,?,?,?,?)",
        ).run(
          row.owner,
          row.id,
          settings.pineconeHost,
          namespace,
          `${row.id}:${i}`,
        );
    }
    db.prepare(
      "INSERT INTO data_migrations VALUES('vector-manifest-v1')",
    ).run();
  })();
}
