import type OpenAI from "openai";
import { z } from "zod";
import { settings } from "../../config";
import { RESEARCH_REVIEW_PROMPT } from "../__prompts__/prompt__research_review";
const Review = z.object({
  needsResearch: z.boolean(),
  followup: z.string().max(2500),
});

// A conditional, tool-free sub-agent; this is an online coverage check, not the offline quality judge.
export async function reviewResearch(
  client: OpenAI,
  records: unknown,
  signal: AbortSignal,
) {
  const response = await client.responses.create(
    {
      model: settings.memoryModel,
      store: false,
      max_output_tokens: 1200,
      input: [
        { role: "system", content: RESEARCH_REVIEW_PROMPT },
        { role: "user", content: JSON.stringify(records) },
      ],
      text: { format: { type: "json_object" } },
    },
    { signal },
  );
  let verdict: z.infer<typeof Review> | null = null;
  if (response.status === "completed") {
    try {
      verdict = Review.parse(JSON.parse(response.output_text));
    } catch {
      /* Fail closed on malformed review. */
    }
  }
  return { verdict, usage: response.usage };
}
