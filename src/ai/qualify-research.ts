import type { Citation } from "../types";
import { auditPageUrl, type EvidenceAudit } from "./claim-audit";

const historyLink = /\/\?thread=[\w-]+#message-[\w-]+/;

function textBlock(answer: string, citation: Citation) {
  const lineStart = answer.lastIndexOf("\n", citation.start - 1) + 1;
  const lineEnd = answer.indexOf("\n", citation.end);
  const end = lineEnd === -1 ? answer.length : lineEnd;
  const line = answer.slice(lineStart, end);
  if (/^\s*(?:\||[-*] |\d+[.)] )/.test(line)) return { start: lineStart, end };
  const paragraphStart = answer.lastIndexOf("\n\n", citation.start - 1);
  const paragraphEnd = answer.indexOf("\n\n", citation.end);
  return {
    start: paragraphStart === -1 ? 0 : paragraphStart + 2,
    end: paragraphEnd === -1 ? answer.length : paragraphEnd,
  };
}

// Keep provider links for inspection while withholding facts from blocks whose cited pages failed capture.
export function qualifyUnavailableResearch(
  answer: string,
  citations: Citation[],
  audit: EvidenceAudit,
  withholdUnsupportedHistory = false,
) {
  const unavailable = new Set(
    audit.sources
      .filter(({ state }) => state === "unavailable")
      .map(({ url }) => url),
  );
  const missing = (citation: Citation) =>
    unavailable.has(auditPageUrl(citation.url) ?? "");
  const blocks = new Map<
    number,
    { start: number; end: number; citations: Citation[]; replacement?: string }
  >();
  for (const citation of citations.filter(missing)) {
    const block = textBlock(answer, citation);
    if (historyLink.test(answer.slice(block.start, block.end))) continue;
    const related = citations.filter(
      (item) => item.start >= block.start && item.end <= block.end,
    );
    if (related.some((item) => !missing(item))) continue;
    blocks.set(block.start, { ...block, citations: related });
  }
  if (blocks.size) {
    for (const match of answer.matchAll(
      /^(?:\*\*)?(?:I|We) (?:checked|verified|confirmed) (?:(?:each|all)\b[^\n.:!?]*|the [^\n.:!?]*\b(?:pages|sources)\b[^\n.:!?]*)([:.])(?:\*\*)?/gim,
    )) {
      const start = match.index;
      const end = start + match[0].length;
      if (
        blocks.has(start) ||
        citations.some((item) => item.start < end && item.end > start)
      )
        continue;
      blocks.set(start, {
        start,
        end,
        citations: [],
        replacement:
          match[1] === ":"
            ? "Official sources:"
            : "I located the official sources.",
      });
    }
  }
  if (withholdUnsupportedHistory) {
    for (const claim of audit.claims) {
      if (
        !claim.historical ||
        claim.status === "supported" ||
        claim.claim.includes("\n")
      )
        continue;
      const previousBreak = answer.lastIndexOf("\n\n", claim.start - 1);
      const nextBreak = answer.indexOf("\n\n", claim.end);
      const paragraph = answer.slice(
        previousBreak === -1 ? 0 : previousBreak + 2,
        nextBreak === -1 ? answer.length : nextBreak,
      );
      if (historyLink.test(paragraph)) continue;
      const prefix = answer.slice(
        answer.lastIndexOf("\n", claim.start - 1) + 1,
        claim.start,
      );
      const connector = /,?\s+(?:while|but|and)\s*$/i.exec(prefix)?.[0] ?? "";
      const start = claim.start - connector.length;
      const tail = /^[.!?]?[ \t]*/.exec(answer.slice(claim.end))?.[0] ?? "";
      const end = claim.end + tail.length;
      if (
        blocks.has(start) ||
        citations.some((item) => item.start < end && item.end > start)
      )
        continue;
      const replacement = connector ? `.${tail.endsWith(" ") ? " " : ""}` : "";
      blocks.set(start, { start, end, citations: [], replacement });
    }
  }
  if (!blocks.size) return { answer, citations, audit };

  const edits: { start: number; end: number; offset: number }[] = [];
  const linked: Citation[] = [];
  let text = "";
  let cursor = 0;
  for (const block of [...blocks.values()].sort((a, b) => a.start - b.start)) {
    if (block.start < cursor) continue;
    text += answer.slice(cursor, block.start);
    if (block.replacement !== undefined) {
      text += block.replacement;
      cursor = block.end;
      edits.push({
        start: block.start,
        end: block.end,
        offset: text.length - cursor,
      });
      continue;
    }
    const line = answer.slice(block.start, block.end);
    const tableLabel = /^\s*\|\s*([^|]+)\|[^\n]*$/.exec(line)?.[1].trim();
    const bullet = /^\s*(?:[-*]|\d+[.)]) /.exec(line)?.[0] ?? "";
    const links = [
      ...new Map(block.citations.map((item) => [item.url, item])).values(),
    ];
    const names = links.map(({ url }) =>
      new URL(url).hostname.replace(/^www\./, ""),
    );
    text += `${tableLabel ? `| ${tableLabel} | ` : bullet}I couldn’t independently verify the details from ${names.join(", ")}.`;
    for (const [index, item] of links.entries()) {
      text += " ";
      const url = auditPageUrl(item.url)!;
      const start = text.length;
      text += `([${names[index]}](${url.replaceAll("(", "%28").replaceAll(")", "%29")}))`;
      linked.push({ ...item, start, end: text.length });
    }
    if (tableLabel) text += " |";
    cursor = block.end;
    edits.push({
      start: block.start,
      end: block.end,
      offset: text.length - cursor,
    });
  }
  text += answer.slice(cursor);

  const retained = <T extends { start: number; end: number }>(
    entry: T,
  ): T[] => {
    if (edits.some((edit) => entry.start < edit.end && entry.end > edit.start))
      return [];
    const offset =
      edits.findLast((edit) => edit.end <= entry.start)?.offset ?? 0;
    return [{ ...entry, start: entry.start + offset, end: entry.end + offset }];
  };
  const claims = audit.claims.flatMap(retained);
  const claimIds = new Set(claims.map(({ id }) => id));
  return {
    answer: text,
    citations: [...citations.flatMap(retained), ...linked].sort(
      (a, b) => a.start - b.start,
    ),
    audit: {
      ...audit,
      status: claims.length ? audit.status : ("unavailable" as const),
      claims,
      comparisons: audit.comparisons.filter(({ currentClaimId }) =>
        claimIds.has(currentClaimId),
      ),
    },
  };
}
