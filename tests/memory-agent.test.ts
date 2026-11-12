import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Memory, Message } from "../src/types";
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("openai", () => ({
  default: class {
    responses = { create };
  },
}));
import { synthesize } from "../src/ai/__agents__/agent__memory";
const user: Message = {
  id: "user-source",
  conversationId: "thread",
  role: "user",
  content: "I prefer concise replies.",
  createdAt: "2026-11-12T00:00:00Z",
  status: "completed",
  citations: [],
  sources: [],
  runId: null,
};
const memory: Memory = {
  id: "memory",
  kind: "preference",
  text: "Prefers concise replies",
  sources: [{ messageId: user.id, quote: user.content }],
  validUntil: null,
  createdAt: user.createdAt,
  version: 1,
};
const entry = {
  kind: memory.kind,
  text: memory.text,
  sources: memory.sources,
  validUntil: null,
};
const signal = () => AbortSignal.timeout(5000);
beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({
    status: "completed",
    output_text: JSON.stringify({ entries: [entry] }),
    usage: { total_tokens: 10 },
  });
});
describe("production memory synthesis boundary", () => {
  it("requests schema-constrained output and returns a validated source-linked proposal", async () => {
    const result = await synthesize([user], [memory], signal());
    expect(result).toMatchObject({
      proposal: { entries: [entry] },
      usage: { total_tokens: 10 },
    });
    const [request, options] = create.mock.calls[0];
    expect(request.text.format).toMatchObject({
      type: "json_schema",
      name: "memory_proposal",
      strict: true,
    });
    expect(request.store).toBe(false);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    const payload = JSON.parse(request.input[1].content);
    expect(payload.previous[0].sources).toEqual(memory.sources);
    expect(payload).not.toHaveProperty("forgotten");
    expect(payload).not.toHaveProperty("blockedMemoryCount");
  });
  it("keeps assistant, incomplete and manually edited memory text out of synthesis", async () => {
    await synthesize(
      [
        user,
        {
          ...user,
          id: "assistant",
          role: "assistant",
          content: "Assistant-only material",
        },
        {
          ...user,
          id: "incomplete",
          status: "failed",
          content: "Incomplete material",
        },
      ],
      [
        memory,
        {
          ...memory,
          id: "override",
          text: "Manual correction",
          userEdited: true,
        },
        {
          ...memory,
          id: "missing",
          text: "Unsupported old summary",
          sources: [{ messageId: "absent", quote: "missing quote" }],
        },
      ],
      signal(),
    );
    const payload = JSON.parse(create.mock.calls[0][0].input[1].content);
    expect(payload.messages.map((m: { id: string }) => m.id)).toEqual([
      user.id,
    ]);
    expect(payload.previous.map((m: { text: string }) => m.text)).toEqual([
      memory.text,
    ]);
  });
  it.each(["assistant-source", "deleted-source"])(
    "rejects a provider proposal citing %s",
    async (messageId) => {
      create.mockResolvedValue({
        status: "completed",
        output_text: JSON.stringify({
          entries: [
            { ...entry, sources: [{ messageId, quote: user.content }] },
          ],
        }),
      });
      await expect(
        synthesize(
          [user, { ...user, id: "assistant-source", role: "assistant" }],
          [],
          signal(),
        ),
      ).rejects.toThrow("unsupported source");
    },
  );
  it("rejects an invented quote even when its source ID is valid", async () => {
    create.mockResolvedValue({
      status: "completed",
      output_text: JSON.stringify({
        entries: [
          {
            ...entry,
            sources: [
              { messageId: user.id, quote: "A quote the user never wrote" },
            ],
          },
        ],
      }),
    });
    await expect(synthesize([user], [], signal())).rejects.toThrow(
      "unsupported source",
    );
  });
  it.each(["incomplete", "failed"])(
    "does not accept %s provider output",
    async (status) => {
      create.mockResolvedValue({
        status,
        output_text: JSON.stringify({ entries: [entry] }),
      });
      await expect(synthesize([user], [], signal())).rejects.toThrow(
        "incomplete",
      );
    },
  );
  it.each(["not json", JSON.stringify({ entries: [{ kind: "invented" }] })])(
    "rejects invalid provider output",
    async (output_text) => {
      create.mockResolvedValue({ status: "completed", output_text });
      await expect(synthesize([user], [], signal())).rejects.toThrow();
    },
  );
  it("allows an empty replacement set", async () => {
    create.mockResolvedValue({
      status: "completed",
      output_text: '{"entries":[]}',
    });
    expect((await synthesize([], [], signal())).proposal.entries).toEqual([]);
  });
});
