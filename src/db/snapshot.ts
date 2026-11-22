import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { Database } from "better-sqlite3";
import { redis } from "../cache/redis";
import { settings } from "../config";

const dataKey = "minimi:db";
const revKey = "minimi:db:rev";

export function databaseFile() {
  const configured = settings.database;
  if (configured === ":memory:") return configured;
  if (process.env.VERCEL && !configured.startsWith("/"))
    return "/tmp/minimi.sqlite";
  return configured;
}

function localRevision(file: string) {
  const sidecar = `${file}.rev`;
  if (!existsSync(sidecar)) return 0;
  return Number(readFileSync(sidecar, "utf8")) || 0;
}

export async function remoteRevision() {
  const client = await redis();
  if (!client) return 0;
  return Number(await client.get(revKey)) || 0;
}

export async function restoreDatabase(file: string) {
  if (file === ":memory:") return;
  const client = await redis();
  if (!client) return;
  const remoteRevision = Number(await client.get(revKey)) || 0;
  if (remoteRevision <= localRevision(file)) return;
  const encoded = await client.get(dataKey);
  if (!encoded) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(encoded, "base64"));
  writeFileSync(`${file}.rev`, String(remoteRevision));
}

export async function persistDatabase(db: Database, file: string) {
  if (file === ":memory:") return;
  const client = await redis();
  if (!client) return;
  db.pragma("wal_checkpoint(TRUNCATE)");
  if (!existsSync(file) || statSync(file).size === 0) return;
  const remote = Number(await client.get(revKey)) || 0;
  const local = localRevision(file);
  if (remote > local) return;
  const next = Math.max(remote, local) + 1;
  writeFileSync(`${file}.rev`, String(next));
  await client.set(dataKey, readFileSync(file).toString("base64"));
  await client.set(revKey, String(next));
}

export async function publishDatabase(db: Database, file: string) {
  if (file === ":memory:" || !existsSync(file) || statSync(file).size === 0)
    return;
  const client = await redis();
  if (!client) return;
  const remoteRevision = Number(await client.get(revKey)) || 0;
  if (remoteRevision === 0) await persistDatabase(db, file);
}
