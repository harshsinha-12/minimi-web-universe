import type { Response } from "openai/resources/responses/responses";
import type { Citation, Source } from "../types";
export function normalizeResponse(response: Response) {
  let text = "";
  const citations: Citation[] = [];
  const sources = new Map<string, Source>();
  const actions: unknown[] = [];
  for (const item of response.output) {
    if (item.type === "message")
      for (const content of item.content) {
        if (content.type !== "output_text") continue;
        const offset = text.length;
        for (const a of content.annotations)
          if (a.type === "url_citation" && /^https?:\/\//i.test(a.url)) {
            citations.push({
              url: a.url,
              title: a.title,
              start: offset + a.start_index,
              end: offset + a.end_index,
            });
            sources.set(a.url, { url: a.url, title: a.title });
          }
        text += content.text;
      }
    if (item.type === "web_search_call") {
      actions.push(item.action);
      if (item.action.type === "search")
        for (const s of item.action.sources ?? [])
          if (s.type === "url")
            sources.set(
              s.url,
              sources.get(s.url) ?? {
                url: s.url,
                title: new URL(s.url).hostname,
              },
            );
    }
  }
  const validCitations = citations.filter(
    (c) =>
      Number.isInteger(c.start) &&
      Number.isInteger(c.end) &&
      c.start >= 0 &&
      c.end > c.start &&
      c.end <= text.length,
  );
  return {
    text,
    citations: validCitations,
    sources: [...sources.values()],
    actions,
    complete: response.status === "completed",
    usage: response.usage,
  };
}
export function annotateMarkdown(text: string, citations: Citation[]) {
  const sorted = [...citations]
    .filter(
      (citation) =>
        citation.start >= 0 &&
        citation.end > citation.start &&
        citation.end <= text.length,
    )
    .sort((a, b) => b.start - a.start);
  let result = text;
  for (const citation of sorted)
    result = result.slice(0, citation.start) + result.slice(citation.end);
  return result
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}
