import { describe, expect, it } from "vitest";
import { pineconeSaveTrace, pineconeTrace } from "../src/memory/semantic";
import { pineconeSource } from "../src/components/thought-label";

describe("Pinecone thought lines", () => {
  it("names a fetch and a save", () => {
    expect(
      pineconeTrace({
        enabled: true,
        skipped: null,
        hits: 2,
        unavailable: false,
      }),
    ).toBe("Fetched 2 similar messages from Pinecone");
    expect(
      pineconeTrace({
        enabled: true,
        skipped: "date",
        hits: 0,
        unavailable: false,
      }),
    ).toMatch(/specific day/);
    expect(
      pineconeTrace({
        enabled: false,
        skipped: null,
        hits: 0,
        unavailable: false,
      }),
    ).toMatch(/off/);
    expect(pineconeSaveTrace(1, 1)).toBe("Saved 1 message to Pinecone");
    expect(pineconeSaveTrace(0, 0)).toMatch(/nothing new/);
  });
  it("keeps a fetch and a save for the sources panel", () => {
    expect(
      pineconeSource([
        { detail: "Conversation context ready" },
        { detail: "Fetched 4 similar messages from Pinecone" },
        { detail: "Saved 2 messages to Pinecone" },
        { detail: "Opening neon.com" },
      ]),
    ).toEqual([
      "Fetched 4 similar messages from Pinecone",
      "Saved 2 messages to Pinecone",
    ]);
    expect(
      pineconeSource([
        { detail: "Pinecone is off, so this turn uses SQLite only" },
      ]),
    ).toBeNull();
  });
});
