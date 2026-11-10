import { z } from "zod";
export type EvalCase = {
  id: string;
  question: string;
  reference: string;
  history: {
    id?: string;
    conversationId?: string;
    role: "user" | "assistant";
    text: string;
    at: string;
  }[];
  evidence: { id: string; url: string; excerpt: string; observedAt: string }[];
  good: string;
  bad: string;
  agent: boolean;
};
const Score = z.object({
  score: z.number().int().min(0).max(4).nullable(),
  reason: z.string(),
});
export const JudgeVerdict = z.object({
  recall: Score,
  temporal: Score,
  grounding: Score,
  helpfulness: Score,
  violations: z.array(
    z.object({
      type: z.enum([
        "fabricated_history",
        "unsupported_claim",
        "noncomparable_units",
        "citation_mismatch",
        "instruction_violation",
      ]),
      quote: z.string().min(1),
      evidenceIds: z.array(z.string()),
      explanation: z.string(),
    }),
  ),
});
export type Verdict = z.infer<typeof JudgeVerdict>;
export function scoreVerdict(
  raw: unknown,
  answer: string,
  evidenceIds: string[],
) {
  const verdict = JudgeVerdict.parse(raw);
  for (const issue of verdict.violations) {
    if (!answer.includes(issue.quote))
      throw new Error("Judge violation must quote the candidate exactly");
    if (issue.evidenceIds.some((id) => !evidenceIds.includes(id)))
      throw new Error("Judge invented an evidence ID");
  }
  const scores = [
    verdict.recall,
    verdict.temporal,
    verdict.grounding,
    verdict.helpfulness,
  ].flatMap((item) => (item.score === null ? [] : [item.score]));
  if (!scores.length) throw new Error("Judge returned no applicable criteria");
  // A polished answer cannot average away a fabricated past conversation or unsupported price change.
  return {
    verdict,
    passed:
      verdict.violations.length === 0 && scores.every((score) => score >= 3),
    score: scores.reduce((a, b) => a + b, 0) / (scores.length * 4),
  };
}
