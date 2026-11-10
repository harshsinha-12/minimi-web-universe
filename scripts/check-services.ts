import "../src/config";
import OpenAI from "openai";
import { redis } from "../src/cache/redis";
import { randomUUID } from "node:crypto";
const client = new OpenAI({ maxRetries: 0, timeout: 15000 });
try {
  const models = await client.models.list();
  const candidates = [
    "gpt-6-astra",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5-mini",
    "gpt-4.1-mini",
  ];
  console.log(
    "OpenAI: authenticated; visible candidates:",
    candidates.filter((id) => models.data.some((m) => m.id === id)).join(", "),
  );
} catch (e) {
  console.log(
    "OpenAI check failed:",
    e instanceof OpenAI.APIError
      ? `HTTP ${e.status ?? "network"} (${e.code ?? "unknown"})`
      : "Connection unavailable",
  );
  process.exitCode = 1;
}
const c = await redis();
if (c) {
  const key = `minimi:health:${randomUUID()}`;
  try {
    await c.set(key, "ok", { EX: 10 });
    console.log(
      "Redis: authenticated; temporary write/read:",
      (await c.get(key)) === "ok" ? "PASS" : "FAIL",
    );
    await c.del(key);
  } finally {
    await c.quit();
  }
} else
  console.log(
    "Redis: unavailable or unconfigured; SQLite fallback will be used",
  );
