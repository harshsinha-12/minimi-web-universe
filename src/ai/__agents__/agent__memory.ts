import { MemoryProposal } from "../../memory/schema";
import { memoryPrompt } from "../__prompts__/prompt__memory";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { settings } from "../../config";
import type { Memory, Message } from "../../types";
export async function synthesize(
  messages: Message[],
  previous: Memory[],
  signal: AbortSignal,
) {
  const client = new OpenAI({ maxRetries: 0, timeout: 50000 });
  // SQL supplies owned, non-excluded records. Keep this provider boundary limited
  // to completed user evidence and automatic memories supported by that evidence.
  const users = messages.filter(
    (m) => m.role === "user" && m.status === "completed",
  );
  const originals = new Map(users.map((m) => [m.id, m]));
  const supportedPrevious = previous.filter(
    (m) =>
      !m.userEdited &&
      m.sources.length > 0 &&
      m.sources.every((source) =>
        originals.get(source.messageId)?.content.includes(source.quote),
      ),
  );
  const payload = JSON.stringify({
    messages: users.map((m) => ({
      id: m.id,
      role: m.role,
      text: m.content,
      at: m.createdAt,
    })),
    previous: supportedPrevious.map((m) => ({
      kind: m.kind,
      text: m.text,
      sources: m.sources,
    })),
  });
  if (payload.length > 120000)
    throw new Error("Consolidation input exceeds the bounded context budget");
  const response = await client.responses.create(
    {
      model: settings.memoryModel,
      store: false,
      max_output_tokens: 4500,
      text: { format: zodTextFormat(MemoryProposal, "memory_proposal") },
      input: [
        {
          role: "system",
          content: memoryPrompt(new Date().toISOString()),
        },
        {
          role: "user",
          content: payload,
        },
      ],
    },
    { signal },
  );
  if (response.status !== "completed")
    throw new Error("Memory synthesis incomplete");
  const proposal = MemoryProposal.parse(JSON.parse(response.output_text));
  for (const entry of proposal.entries)
    for (const source of entry.sources) {
      if (!originals.get(source.messageId)?.content.includes(source.quote))
        throw new Error(
          "Memory synthesis returned unsupported source evidence",
        );
    }
  return {
    proposal,
    usage: response.usage,
  };
}
