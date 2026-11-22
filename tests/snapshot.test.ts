import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";

const saved: { rev: string; blob: string | null } = { rev: "0", blob: null };
vi.mock("../src/cache/redis", () => ({
  redis: async () => ({
    get: async (key: string) =>
      key === "minimi:db:rev" ? saved.rev : saved.blob,
    set: async (key: string, value: string) => {
      if (key === "minimi:db:rev") saved.rev = value;
      if (key === "minimi:db") saved.blob = value;
      return "OK";
    },
  }),
}));

const dirs: string[] = [];
afterEach(() => {
  saved.rev = "0";
  saved.blob = null;
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("durable redis database copy", () => {
  it("saves the sqlite file without an expiry and restores a newer copy", async () => {
    const { persistDatabase, restoreDatabase } =
      await import("../src/db/snapshot");
    const dir = mkdtempSync(join(tmpdir(), "minimi-db-"));
    dirs.push(dir);
    const file = join(dir, "minimi.sqlite");
    const db = new Database(file);
    db.exec("CREATE TABLE notes(text)");
    db.prepare("INSERT INTO notes VALUES(?)").run("HubSpot shortlist");
    await persistDatabase(db, file);
    db.close();
    expect(saved.rev).toBe("1");
    expect(saved.blob?.length).toBeGreaterThan(0);
    rmSync(file);
    rmSync(`${file}.rev`);
    await restoreDatabase(file);
    const restored = new Database(file);
    expect(restored.prepare("SELECT text FROM notes").get()).toEqual({
      text: "HubSpot shortlist",
    });
    restored.close();
  });
});
