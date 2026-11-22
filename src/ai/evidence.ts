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
function fenced(text: string, index: number) {
  const fence = /```/g;
  let open = false;
  for (const match of text.matchAll(fence)) {
    if (match.index === undefined || match.index >= index) break;
    open = !open;
  }
  return open;
}
function citationMarker(citation: Citation) {
  let label = citation.title.replace(/\s+/g, " ").trim();
  if (!label || /https?:\/\//i.test(label)) {
    try {
      label = new URL(citation.url).hostname.replace(/^www\./, "");
    } catch {
      label = "source";
    }
  }
  label = label.replace(/[\[\]\\]/g, "").slice(0, 80) || "source";
  const href = citation.url.replace(/[()\s]/g, (char) =>
    encodeURIComponent(char),
  );
  return `[${label}](${href})`;
}
export function annotateMarkdown(text: string, citations: Citation[]) {
  const sorted = [...citations]
    .filter(
      (citation) =>
        citation.start >= 0 &&
        citation.end > citation.start &&
        citation.end <= text.length &&
        !fenced(text, citation.start),
    )
    .sort((a, b) => b.start - a.start || a.end - b.end);
  let current = text;
  let limit = text.length;
  for (const citation of sorted) {
    if (citation.end > limit) continue;
    let start = citation.start;
    let end = citation.end;
    if (
      current[start - 1] === "(" &&
      current[end] === ")" &&
      !current.slice(start, end).includes("\n")
    ) {
      start -= 1;
      end += 1;
    }
    current = `${current.slice(0, start)}${citationMarker(citation)}${current.slice(end)}`;
    limit = start;
  }
  return current;
}
