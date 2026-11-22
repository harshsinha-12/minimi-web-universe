export type AnswerDepth = "brief" | "deep";

export function researchPolicy(
  question: string,
  forceSearch: boolean,
  historical: boolean,
) {
  const noSearch =
    /\b(?:don['’]t|do not|never)\s+(?:use\s+)?(?:the\s+)?(?:web\s+)?(?:search|browse)|\bwithout (?:web )?search|\bno (?:web )?search\b/i.test(
      question,
    );
  const recheck =
    /\b(since|changed|still (correct|true|accurate)|recheck|verify|up.to.date)\b/i.test(
      question,
    );
  const fresh =
    /\b(today|latest|current|pricing|price|release|news|cost|best|recommend|compare|weather|search|research|who (is|are)|when did)\b/i.test(
      question,
    );
  const required = !noSearch && (forceSearch || recheck);
  return {
    recheck,
    fresh,
    required,
    allow: !noSearch && !(historical && !required && !fresh),
  };
}

export function depthGuidance(depth: AnswerDepth) {
  if (depth === "deep")
    return "Answer depth: in-depth. Split the question into at most four sub-questions. Answer a sub-question from conversation memory or your own knowledge when that is enough. Use web search only for a sub-question that needs a current, niche, or cited fact. Say which parts came from memory and which came from the web. Keep the final answer readable.";
  return "Answer depth: brief. Stay concise. One focused pass. Do not expand into a report.";
}

export function searchAvailability(
  search: boolean,
  toolChoice: "auto" | "required",
) {
  if (!search)
    return "Web search is off for this request. Do not claim fresh verification.";
  if (toolChoice === "required")
    return "Web search is required for this request. Do not claim a current fact without using it.";
  return "Web search is available and automatic. Use it only when memory and your own knowledge are not enough for a current, niche, or uncertain fact. Otherwise answer from memory or your own knowledge.";
}
