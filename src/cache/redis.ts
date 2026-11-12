import { createClient } from "redis";
import "../config";
let client: ReturnType<typeof createClient> | null = null;
let pending: Promise<ReturnType<typeof createClient> | null> | null = null;
let retryAfter = 0;
export async function redis() {
  if (client?.isReady) return client;
  if (!process.env.REDIS_HOST || Date.now() < retryAfter) return null;
  if (pending) return pending;
  pending = (async () => {
    const c = createClient({
      username: process.env.REDIS_USERNAME || "default",
      password: process.env.REDIS_PASSWORD,
      socket: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT || 6379),
        ...(process.env.REDIS_TLS === "true" ? { tls: true as const } : {}),
        connectTimeout: 2000,
        reconnectStrategy: false,
      },
    });
    c.on("error", () => {});
    try {
      await c.connect();
      client = c;
      return c;
    } catch {
      retryAfter = Date.now() + 30000;
      c.destroy();
      return null;
    } finally {
      pending = null;
    }
  })();
  return pending;
}
export async function cached<T>(key: string, load: () => T): Promise<T> {
  const c = await redis();
  try {
    const hit = await c?.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    /* local authority remains available */
  }
  const value = load();
  try {
    await c?.set(key, JSON.stringify(value), { EX: 300 });
  } catch {
    /* best effort */
  }
  return value;
}
export async function wakeMemory(owner: string) {
  try {
    await (await redis())?.publish("minimi:memory:wake", owner);
  } catch {
    /* SQLite polling recovers lost signals */
  }
}
export async function closeRedis() {
  await pending;
  client?.destroy();
  client = null;
}

// Revisioned keys become unreadable immediately. A durable SQL request also removes cached text.
export async function cleanupContextCache(
  store: import("../db/store").Store,
  owner: string,
) {
  const c = await redis();
  if (!c) {
    if (!process.env.REDIS_HOST)
      store.db.prepare("DELETE FROM cache_cleanup WHERE owner=?").run(owner);
    return;
  }
  try {
    for await (const keys of c.scanIterator({
      MATCH: `minimi:context:*:${owner}:*`,
      COUNT: 100,
    }))
      if (keys.length) await c.del(keys);
    store.db.prepare("DELETE FROM cache_cleanup WHERE owner=?").run(owner);
  } catch {
    /* Worker retries; old keys also expire within five minutes. */
  }
}
