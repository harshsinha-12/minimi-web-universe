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
  const sorted = [...citations].sort((a, b) => b.start - a.start);
  let result = text;
  for (const c of sorted) {
    const original = text.slice(c.start, c.end);
    const label = /^\s*(?:|\[|【)/u.test(original)
      ? `↗ ${new URL(c.url).hostname.replace(/^www\./, "")}`
      : original;
    result =
      result.slice(0, c.start) +
      `[${label.replace(/[\[\]]/g, "")}](<${c.url}>)` +
      result.slice(c.end);
  }
  return result;
}
