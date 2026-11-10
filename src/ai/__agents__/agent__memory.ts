import { MemoryProposal } from "../../memory/schema";
import { memoryPrompt } from "../__prompts__/prompt__memory";
import OpenAI from "openai";
import { settings } from "../../config";
import type { Memory, Message } from "../../types";
export async function synthesize(
  messages: Message[],
  previous: Memory[],
  forgotten: string[],
  signal: AbortSignal,
) {
  const client = new OpenAI({ maxRetries: 0, timeout: 50000 });
  const payload = JSON.stringify({
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      text: m.content,
      at: m.createdAt,
    })),
    previous: previous.map((m) => ({
      kind: m.kind,
      text: m.text,
      sources: m.sources.map((s) => s.messageId),
    })),
    forgotten,
  });
  if (payload.length > 120000)
    throw new Error("Consolidation input exceeds the bounded context budget");
  const response = await client.responses.create(
    {
      model: settings.memoryModel,
      store: false,
      max_output_tokens: 4500,
      text: { format: { type: "json_object" } },
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
  return {
    proposal: MemoryProposal.parse(JSON.parse(response.output_text)),
    usage: response.usage,
  };
}
