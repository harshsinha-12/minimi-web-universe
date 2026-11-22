import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { Store } from "../src/db/store";
import { runAgent } from "../src/ai/__agents__/agent__master";
import { emptyAudit } from "../src/ai/claim-audit";

const { create, audit } = vi.hoisted(() => ({
  create: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class OpenAI {
    static APIError = Error;
    responses = { create };
  },
}));
vi.mock("../src/ai/claim-audit", async (original) => ({
  ...(await original<typeof import("../src/ai/claim-audit")>()),
  auditAnswer: audit,
}));
vi.mock("../src/cache/redis", () => ({
  cached: (_key: string, read: () => unknown) => read(),
}));

it("keeps a completed recheck if the one targeted follow-up fails", async () => {
  const content = "The official page lists current pricing. [Source]";
  const url = "https://example.com/pricing";
  create.mockImplementationOnce(async function* () {
    yield {
      type: "response.completed",
      response: {
        id: "first-completed-pass",
        status: "completed",
        output: [
          { type: "web_search_call", action: { type: "search", sources: [] } },
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: content,
                annotations: [
                  {
                    type: "url_citation",
                    url,
                    title: "Pricing",
                    start_index: content.indexOf("[Source]"),
                    end_index: content.length,
                  },
                ],
              },
            ],
          },
        ],
        usage: { input_tokens: 5, output_tokens: 5 },
      },
    };
  });
  create.mockRejectedValueOnce(new Error("Follow-up provider failure"));
  audit.mockResolvedValueOnce({
    audit: emptyAudit(),
    usage: null,
    followup: "Check the vendor's official region terms.",
  });
  const store = new Store(":memory:");
  try {
    const owner = "research-eval";
    const thread = store.createConversation(owner);
    const earlier = store.begin(
      owner,
      thread,
      randomUUID(),
      "We compared the Alpha hosting plan.",
    );
    store.finish(
      owner,
      earlier.run.id,
      "The earlier Alpha plan was discussed.",
      [],
      [],
      [],
      {},
    );
    const question = "Has Alpha hosting pricing changed since we discussed it?";
    const { run } = store.begin(owner, thread, randomUUID(), question);
    await runAgent({
      store,
      owner,
      conversationId: thread,
      runId: run.id,
      question,
      timezone: "UTC",
      forceSearch: true,
      useSearchCache: false,
      signal: new AbortController().signal,
      emit: () => {},
    });
    expect(
      create.mock.calls.map(([request]) => request.max_tool_calls),
    ).toEqual([5, 3]);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(store.run(owner, run.id)).toMatchObject({
      status: "completed",
      metrics: {
        searchActions: 1,
        researchPasses: 2,
        responseId: "first-completed-pass",
      },
    });
    expect(store.messages(owner, thread).at(-1)).toMatchObject({
      content,
      citations: [{ url }],
    });
  } finally {
    store.close();
  }
});
