import { describe, expect, it } from "vitest";
import { searchActivity } from "../src/ai/search-activity";
import { depthGuidance, searchAvailability } from "../src/ai/policy";

describe("search activity labels", () => {
  it("names the query and the pages opened", () => {
    expect(
      searchActivity({
        type: "search",
        queries: ["PostgreSQL 18 release date", "PostgreSQL 18 changelog"],
        sources: [
          { url: "https://www.postgresql.org/docs/release/" },
          { url: "https://www.postgresql.org/docs/release/" },
        ],
      }),
    ).toBe(
      "Searching “PostgreSQL 18 release date” and 1 more · postgresql.org",
    );
    expect(
      searchActivity({
        type: "open_page",
        url: "https://www.postgresql.org/docs/current/release.html",
      }),
    ).toBe("Opening postgresql.org");
    expect(
      searchActivity({
        type: "find_in_page",
        pattern: "18.1",
        url: "https://www.postgresql.org/docs/release/",
      }),
    ).toBe("Finding “18.1” in postgresql.org");
    expect(searchActivity({ type: "search" })).toBeNull();
  });
  it("keeps brief answers concise and makes in-depth search optional", () => {
    expect(depthGuidance("brief")).toMatch(/concise/);
    expect(depthGuidance("deep")).toMatch(/sub-question/);
    expect(searchAvailability(true, "auto")).toMatch(/automatic/);
    expect(searchAvailability(false, "auto")).toMatch(/off/);
  });
});
