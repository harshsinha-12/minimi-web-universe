import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { settings } from "../../config";
import { JUDGE_PROMPT } from "../__prompts__/prompt__judge";
import {
  JudgeVerdict,
  scoreVerdict,
  type EvalCase,
} from "../__evals__/eval__schema";

// Offline only. Never import this agent into request handling or use it to rewrite a live answer.
export async function judgeAnswer(test: EvalCase, answer: string) {
  const start = Date.now();
  const client = new OpenAI({ maxRetries: 0, timeout: 45000 });
  const response = await client.responses.create(
    {
      model: settings.judgeModel,
      store: false,
      max_output_tokens: 2800,
      text: { format: zodTextFormat(JudgeVerdict, "answer_quality") },
      input: [
        { role: "system", content: JUDGE_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            question: test.question,
            reference: test.reference,
            history: test.history,
            evidence: test.evidence,
            candidate: answer,
          }),
        },
      ],
    },
    { signal: AbortSignal.timeout(45000) },
  );
  if (response.status !== "completed")
    throw new Error("Judge did not complete; no score recorded");
  return {
    ...scoreVerdict(
      JSON.parse(response.output_text),
      answer,
      test.evidence.map((e) => e.id),
    ),
    model: settings.judgeModel,
    elapsedMs: Date.now() - start,
    usage: response.usage,
  };
}
