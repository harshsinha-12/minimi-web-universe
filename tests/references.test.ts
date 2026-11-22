import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Store } from "../src/db/store";
import {
  chatReference,
  groundChatReferences,
  parseChatReference,
} from "../src/ai/chat-reference";
import { annotateMarkdown } from "../src/ai/evidence";
import {
  attachedPageNote,
  pageLink,
  pastedPageLinks,
  refersToPage,
  resolvePageLinks,
} from "../src/ai/page-links";
import type { Message } from "../src/types";

const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));

const thread = "11111111-1111-4111-8111-111111111111";
const message = "22222222-2222-4222-8222-222222222222";

function user(
  patch: Partial<Message> & Pick<Message, "id" | "content" | "runId">,
): Message {
  return {
    conversationId: thread,
    role: "user",
    createdAt: "2026-11-22T00:00:00.000Z",
    status: "completed",
    citations: [],
    sources: [],
    ...patch,
  };
}

describe("pasted page links", () => {
  it("keeps public https pages and drops private or credentialed urls", () => {
    expect(pageLink("https://example.com/pricing#annual")).toBe(
      "https://example.com/pricing",
    );
    expect(pageLink("http://example.com")).toBeNull();
    expect(pageLink("https://user:pass@example.com/secret")).toBeNull();
    expect(pageLink("https://localhost/admin")).toBeNull();
    expect(pageLink("https://127.0.0.1/")).toBeNull();
    expect(pageLink("https://files.local/a")).toBeNull();
  });
  it("turns pasted urls into attachments and leaves the question", () => {
    const extracted = pastedPageLinks(
      "See https://example.com/pricing, and https://example.com/pricing again.",
      [],
    );
    expect(extracted.links).toEqual(["https://example.com/pricing"]);
    expect(extracted.remainder).toBe("See and again.");
  });
  it("leaves text alone when no new public page was pasted", () => {
    expect(pastedPageLinks("  hello  world  ", []).remainder).toBe(
      "  hello  world  ",
    );
  });
  it("keeps a fifth url in the text", () => {
    const existing = [1, 2, 3, 4].map(
      (index) => `https://example.com/${index}`,
    );
    const extracted = pastedPageLinks("https://example.com/5", existing);
    expect(extracted.links).toEqual(existing);
    expect(extracted.remainder).toBe("https://example.com/5");
  });
  it("resolves this page and an ordinal from the previous turn", () => {
    const messages = [
      user({
        id: "one",
        runId: "run-1",
        content: "Compare these",
        links: ["https://example.com/first", "https://example.com/second"],
      }),
      user({
        id: "two",
        runId: "run-2",
        content: "What does this page say about annual billing?",
      }),
    ];
    expect(resolvePageLinks(messages, "run-2", messages[1].content)).toEqual([
      "https://example.com/first",
      "https://example.com/second",
    ]);
    expect(
      resolvePageLinks(messages, "run-2", "What about the second page?"),
    ).toEqual(["https://example.com/second"]);
    expect(resolvePageLinks(messages, "run-1", "Compare these")).toEqual(
      messages[0].links,
    );
  });
  it("does not treat an ordinary document question as an attachment", () => {
    expect(refersToPage("What is the document object model?")).toBe(false);
    expect(refersToPage("What does this page say?")).toBe(true);
    expect(attachedPageNote([])).toBe("");
    expect(attachedPageNote(["https://example.com/a"])).toContain(
      "https://example.com/a",
    );
  });
});

describe("chat message references", () => {
  it("round-trips an exact message link", () => {
    expect(parseChatReference(chatReference(thread, message))).toEqual({
      thread,
      message,
    });
    expect(parseChatReference(`/?thread=${thread}#message=${message}`)).toEqual(
      {
        thread,
        message,
      },
    );
    expect(
      parseChatReference("/?thread=not-an-id#message-also-not"),
    ).toBeNull();
  });
  it("keeps an owned history link and shifts a later citation", () => {
    const owned = `[earlier conversation](/?thread=${thread}#message-${message})`;
    const fake = `[chat](/?thread=${thread}#message-33333333-3333-4333-8333-333333333333)`;
    const answer = `Known ${owned}. Unknown ${fake} then [1]`;
    const start = answer.indexOf("[1]");
    const grounded = groundChatReferences(
      answer,
      [{ id: message, conversationId: thread }],
      [
        {
          url: "https://example.com/pricing",
          title: "Official pricing",
          start,
          end: start + 3,
        },
      ],
    );
    expect(grounded.text).toBe(`Known ${owned}. Unknown chat then [1]`);
    expect(grounded.citations[0]).toMatchObject({
      start: grounded.text.indexOf("[1]"),
      end: grounded.text.indexOf("[1]") + 3,
    });
  });
});

describe("visible citations", () => {
  it("places a source beside multilingual text and leaves fenced code unchanged", () => {
    const text = "価格は [1] です";
    const start = text.indexOf("[1]");
    expect(
      annotateMarkdown(text, [
        {
          url: "https://example.com/pricing",
          title: "公式価格",
          start,
          end: start + 3,
        },
      ]),
    ).toBe("価格は [公式価格](https://example.com/pricing) です");
    const fenced = "```\nPrice [1]\n```";
    const marker = fenced.indexOf("[1]");
    expect(
      annotateMarkdown(fenced, [
        {
          url: "https://example.com/pricing",
          title: "Official pricing",
          start: marker,
          end: marker + 3,
        },
      ]),
    ).toBe(fenced);
  });
});

describe("stored page attachments", () => {
  it("persists links on the user turn and keeps them when the text is edited", () => {
    const store = new Store(":memory:");
    stores.push(store);
    const id = store.createConversation("alice");
    const links = ["https://example.com/pricing"];
    store.begin(
      "alice",
      id,
      randomUUID(),
      "Please read the attached page.",
      undefined,
      links,
    );
    const saved = store.messages("alice", id)[0];
    expect(saved.links).toEqual(links);
    store.editMessage("alice", saved.id, "What about annual billing?");
    expect(store.message("alice", saved.id)?.links).toEqual(links);
    store.editMessage(
      "alice",
      saved.id,
      "Use https://example.com/docs instead.",
    );
    expect(store.message("alice", saved.id)?.links).toEqual([
      "https://example.com/docs",
    ]);
  });
});
