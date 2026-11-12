import { describe, expect, it, vi } from "vitest";
import { resolveDate } from "../src/time/resolve";
import { buildContext } from "../src/ai/context";
import { Store } from "../src/db/store";
import { randomUUID } from "node:crypto";
vi.mock("../src/cache/redis", () => ({
  cached: async (_key: string, load: () => unknown) => load(),
}));
const clock = new Date("2026-11-12T12:00:00Z");
describe("broader historical windows", () => {
  it.each(["last week", "previous week"])(
    "resolves %s as the previous Monday through Sunday",
    (q) => {
      expect(resolveDate(q, "Asia/Kolkata", clock)).toMatchObject({
        from: "2026-11-01T18:30:00.000Z",
        to: "2026-11-08T18:30:00.000Z",
      });
    },
  );
  it("starts this week on Monday", () =>
    expect(resolveDate("this week", "UTC", clock)?.from).toBe(
      "2026-11-09T00:00:00.000Z",
    ));
  it.each(["three days ago", "3 days ago"])("resolves %s", (q) =>
    expect(resolveDate(q, "UTC", clock)?.label).toBe("9 November 2026"),
  );
  it("handles weeks ago across year boundaries", () =>
    expect(
      resolveDate("two weeks ago", "UTC", new Date("2027-01-04T12:00:00Z"))
        ?.label,
    ).toBe("21 December 2026"));
  it("includes today in the last three days", () =>
    expect(resolveDate("last three days", "UTC", clock)).toMatchObject({
      from: "2026-11-10T00:00:00.000Z",
      to: "2026-11-13T00:00:00.000Z",
    }));
  it.each([
    "between 3 November and 7 November",
    "from 3 to 7 November 2026",
    "between November 3 and November 7, 2026",
    "from 2026-11-03 to 2026-11-07",
  ])("includes both endpoint days: %s", (q) =>
    expect(resolveDate(q, "Asia/Kolkata", clock)).toMatchObject({
      from: "2026-11-02T18:30:00.000Z",
      to: "2026-11-07T18:30:00.000Z",
    }),
  );
  it("resolves abbreviated range crossing New Year", () =>
    expect(
      resolveDate("from 30 December to 2 January 2027", "UTC", clock),
    ).toMatchObject({
      from: "2026-12-30T00:00:00.000Z",
      to: "2027-01-03T00:00:00.000Z",
    }));
  it.each([
    "between 31 November and 7 December",
    "from 7 November to 3 November",
    "between 2026-11-99 and 2026-12-02",
    "zero days",
    "last zero days",
    "negative days ago",
  ])("rejects invalid windows: %s", (q) =>
    expect(resolveDate(q, "UTC", clock)).toBeNull(),
  );
  it("uses the local day for an offset and falls back for invalid timezones", () => {
    const late = new Date("2026-11-12T21:00:00Z");
    expect(resolveDate("three days ago", "Asia/Kolkata", late)?.label).toBe(
      "10 November 2026",
    );
    expect(resolveDate("three days ago", "not-a-zone", late)?.label).toBe(
      "9 November 2026",
    );
  });
  it("uses calendar days through the daylight-saving transition", () => {
    const d = resolveDate(
      "from 31 October to 2 November",
      "America/New_York",
      clock,
    )!;
    expect((Date.parse(d.to) - Date.parse(d.from)) / 3600000).toBe(73);
  });
  it("retrieves both endpoints across threads and excludes the following day", async () => {
    const store = new Store(":memory:");
    try {
      for (const date of ["2026-11-03", "2026-11-07", "2026-11-08"]) {
        const id = store.createConversation("alice");
        const { run } = store.begin(
          "alice",
          id,
          randomUUID(),
          `Asked on ${date}`,
          `${date}T12:00:00.000Z`,
        );
        store.finish("alice", run.id, "ok", [], [], [], {});
      }
      const thread = store.createConversation("alice");
      const context = await buildContext(
        store,
        "alice",
        thread,
        "What did I ask between 3 November and 7 November?",
        "UTC",
        clock,
      );
      expect(
        context.messages.filter((m) => m.role === "user").map((m) => m.content),
      ).toEqual(["Asked on 2026-11-03", "Asked on 2026-11-07"]);
    } finally {
      store.close();
    }
  });
});
