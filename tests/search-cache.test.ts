import { afterEach, describe, expect, it } from "vitest";
import { Store } from "../src/db/store";
import {
  isContextDependent,
  isVolatileQuestion,
  normalizeQuestion,
  questionKey,
  searchDecision,
  turnSearchMode,
  type CheckedPage,
} from "../src/ai/search-cache";
import { retainPreviewObservation } from "../src/server/link-previews";
import { pageFingerprint, visibleText } from "../src/server/page-text";
import {
  pageFreshness,
  previewCard,
  previewSentiment,
  sourceConfidence,
} from "../src/server/source-chips";
import type { Message } from "../src/types";

const now = Date.parse("2026-11-11T12:00:00.000Z");
const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
function page(
  state: CheckedPage["state"],
  excerpt = "The stable documentation explains WAL mode and how writers cooperate.",
): CheckedPage {
  return {
    url: "https://example.com/wal",
    state,
    title: "WAL",
    excerpt: state === "unavailable" ? "" : excerpt,
    previousExcerpt:
      "The stable documentation explains WAL mode and how writers cooperate.",
  };
}
function message(patch: Partial<Message> = {}): Message {
  return {
    id: "m",
    conversationId: "c",
    role: "assistant",
    content: "answer",
    createdAt: "2026-11-11T00:00:00.000Z",
    status: "completed",
    citations: [],
    sources: [],
    runId: null,
    ...patch,
  };
}

describe("saved source reuse", () => {
  it("keeps punctuation, conversation, and requested URLs distinct", () => {
    expect(questionKey("What's the WAL mode?", "thread")).toBe(
      questionKey("whats the wal mode", "thread"),
    );
    expect(normalizeQuestion("See https://example.com/a, please.")).toBe(
      "see please",
    );
    expect(
      questionKey("Summarize https://example.com/product-a", "thread"),
    ).not.toBe(
      questionKey("Summarize https://example.com/product-b", "thread"),
    );
    expect(
      questionKey("Summarize https://example.com/product-a.", "thread"),
    ).toBe(questionKey("summarize https://example.com/product-a", "thread"));
    expect(
      questionKey("How much does the Pro plan cost?", "thread-a"),
    ).not.toBe(questionKey("How much does the Pro plan cost?", "thread-b"));
    expect(isContextDependent("How much does it cost?")).toBe(true);
    expect(isContextDependent("How does SQLite WAL mode work?")).toBe(false);
  });
  it("does not pair an older preview body with a newer page observation", () => {
    const preview = {
      url: "https://example.com/a",
      title: "A",
      description: "",
      domain: "example.com",
      image: null,
      icon: null,
      excerpt: "version A",
      textHash: "hash-a",
      sentiment: {
        label: "neutral" as const,
        reason: "The preview wording has no clear positive or negative tone.",
      },
      etag: '"page-a"',
      lastModified: null,
      fetchedAt: "2026-11-11T12:00:00.000Z",
    };
    expect(
      retainPreviewObservation(preview, {
        fetchedAt: "2026-11-11T11:00:00.000Z",
      }),
    ).toMatchObject({ textHash: "hash-a", etag: '"page-a"' });
    expect(
      retainPreviewObservation(preview, {
        fetchedAt: "2026-11-11T12:30:00.000Z",
      }),
    ).toBeNull();
  });
  it("reuses a stable unchanged page and skips hosted search", () => {
    const decision = searchDecision({
      question: "How does SQLite WAL mode work?",
      forceSearch: false,
      recheck: false,
      savedAt: "2026-11-11T11:00:00.000Z",
      now,
      pages: [page("unchanged")],
    });
    expect(decision.reuse).toBe(true);
    expect(decision.detail).toMatch(/skips a new web search/);
    expect(
      turnSearchMode({ allow: true, required: true, reuse: true }),
    ).toEqual({ search: false, toolChoice: "auto" });
  });
  it("searches again when visible text changes, even inside the fresh window", () => {
    const decision = searchDecision({
      question: "What is the latest SQLite release?",
      forceSearch: false,
      recheck: false,
      savedAt: "2026-11-11T11:50:00.000Z",
      now,
      pages: [page("changed", "SQLite 3.99.0 is the newest release.")],
    });
    expect(decision.reuse).toBe(false);
    expect(decision.note).toContain("CHANGED");
    expect(decision.note).toContain(
      JSON.stringify("SQLite 3.99.0 is the newest release."),
    );
    expect(isVolatileQuestion("What is the latest SQLite release?")).toBe(true);
  });
  it("does not reuse a volatile page after twenty minutes", () => {
    const decision = searchDecision({
      question: "What is the current price?",
      forceSearch: false,
      recheck: false,
      savedAt: "2026-11-11T11:00:00.000Z",
      now,
      pages: [page("unchanged")],
    });
    expect(decision.reuse).toBe(false);
    expect(decision.detail).toMatch(/fresh search/);
  });
  it("keeps historical rechecks on a new search", () => {
    const decision = searchDecision({
      question: "Has the price changed since Tuesday?",
      forceSearch: false,
      recheck: true,
      savedAt: "2026-11-11T11:50:00.000Z",
      now,
      pages: [page("unchanged")],
    });
    expect(decision.reuse).toBe(false);
    expect(decision.note).toMatch(/historical recheck/);
  });
  it("does not reuse when the user forces search or a page cannot be checked", () => {
    expect(
      searchDecision({
        question: "How does SQLite WAL mode work?",
        forceSearch: true,
        recheck: false,
        savedAt: "2026-11-11T11:50:00.000Z",
        now,
        pages: [page("unchanged")],
      }).reuse,
    ).toBe(false);
    expect(
      searchDecision({
        question: "How does SQLite WAL mode work?",
        forceSearch: false,
        recheck: false,
        savedAt: "2026-11-11T11:50:00.000Z",
        now,
        pages: [page("unavailable")],
      }).reuse,
    ).toBe(false);
  });
  it("requires search for a fresh question and not for a reused or history-only turn", () => {
    expect(
      turnSearchMode({ allow: true, required: true, reuse: false }),
    ).toEqual({ search: true, toolChoice: "required" });
    expect(
      turnSearchMode({ allow: false, required: false, reuse: false }),
    ).toEqual({ search: false, toolChoice: "auto" });
  });
});

describe("page text and source chips", () => {
  it("ignores script text when hashing a page", () => {
    const first = pageFingerprint(
      "<html><script>secret token</script><p>Visible manual</p></html>",
    );
    const sameScript = pageFingerprint(
      "<html><script>other secret</script><p>Visible manual</p></html>",
    );
    const edited = pageFingerprint(
      "<html><script>secret token</script><p>Visible manual updated</p></html>",
    );
    expect(visibleText("<style>.x{}</style>Hello")).toBe("Hello");
    expect(first.hash).toBe(sameScript.hash);
    expect(first.hash).not.toBe(edited.hash);
    expect(first.text).not.toContain("secret");
  });
  it("reads tone from preview wording and cancels a negated hit", () => {
    expect(previewSentiment("Profits surge", "Strong launch").label).toBe(
      "positive",
    );
    expect(previewSentiment("Shares plunge", "Lawsuit filed").label).toBe(
      "negative",
    );
    expect(previewSentiment("Profits surge", "despite the lawsuit").label).toBe(
      "mixed",
    );
    expect(
      previewSentiment(
        "Quarterly documentation",
        "The company published its developer notes for this quarter.",
      ).label,
    ).toBe("neutral");
    expect(previewSentiment("Notes", "").label).toBe("unclear");
    expect(
      previewSentiment(
        "Market note",
        "This is not a decline in sales across the public market today.",
      ).label,
    ).toBe("neutral");
  });
  it("lowers confidence when the page changed and raises it for a cited match", () => {
    expect(pageFreshness("abc", "abc")).toBe("unchanged");
    expect(pageFreshness("abc", "def")).toBe("changed");
    expect(pageFreshness(null, "abc")).toBe("unchecked");
    expect(
      sourceConfidence({ cited: true, freshness: "unchanged" }).level,
    ).toBe("high");
    expect(sourceConfidence({ cited: true, freshness: "changed" }).level).toBe(
      "low",
    );
    const card = previewCard(
      message({
        citations: [
          {
            url: "https://example.com/wal/",
            title: "WAL",
            start: 0,
            end: 3,
          },
        ],
      }),
      {
        url: "https://example.com/wal",
        title: "Shares plunge",
        description: "A lawsuit followed the outage.",
        domain: "example.com",
        image: null,
        textHash: "same",
        sentiment: previewSentiment(
          "Shares plunge",
          "A lawsuit followed the outage.",
        ),
      },
      { textHash: "same" },
    );
    expect(card.sentiment.tone).toBe("negative");
    expect(card.confidence.tone).toBe("high");
    expect(card.freshness.tone).toBe("unchanged");
    expect(card).not.toHaveProperty("textHash");
  });
});

describe("owner scoped search lookups", () => {
  it("keeps saved urls and page hashes per owner and replaces a changed hash", () => {
    const store = new Store(":memory:");
    stores.push(store);
    store.savePageObservation({
      url: "https://example.com/wal",
      etag: '"1"',
      lastModified: null,
      textHash: "one",
      title: "WAL",
      excerpt: "first",
      fetchedAt: "2026-11-11T00:00:00.000Z",
    });
    store.savePageObservation({
      url: "https://example.com/wal",
      etag: '"2"',
      lastModified: null,
      textHash: "two",
      title: "WAL",
      excerpt: "second",
      fetchedAt: "2026-11-11T01:00:00.000Z",
    });
    expect(store.pageObservation("https://example.com/wal")).toMatchObject({
      textHash: "two",
      excerpt: "second",
      etag: '"2"',
    });
    store.saveSearchLookup(
      "alice",
      "key",
      ["https://example.com/wal"],
      "2026-11-11T01:00:00.000Z",
    );
    expect(store.searchLookup("alice", "key")?.urls).toEqual([
      "https://example.com/wal",
    ]);
    expect(store.searchLookup("bob", "key")).toBeNull();
  });
});
