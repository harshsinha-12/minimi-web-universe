import type { Message } from "../types";

export const maxPageLinks = 4;
export const maxPageLinkLength = 2048;

export function pageLink(raw: string) {
  if (raw.length > maxPageLinkLength) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !url.hostname.includes(".") ||
      /(?:^|\.)(?:localhost|local)\.?$/i.test(url.hostname) ||
      /^[\d.]+$/.test(url.hostname)
    )
      return null;
    url.hash = "";
    return url.href.length <= maxPageLinkLength ? url.href : null;
  } catch {
    return null;
  }
}

export function pageLinkLabel(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    let path = parsed.pathname === "/" ? "" : parsed.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      path = parsed.pathname;
    }
    const label = `${host}${path}${parsed.search}`;
    return label.length > 42 ? `${label.slice(0, 41)}…` : label;
  } catch {
    return "page";
  }
}

export function pastedPageLinks(text: string, existing: string[]) {
  const links = new Set(existing);
  let taken = false;
  const remainder = text.replace(/https:\/\/[^\s<>"'`]+/gi, (raw) => {
    const clean = raw.replace(/[.,;:!?)]+$/g, "");
    const url = pageLink(clean);
    if (!url || (!links.has(url) && links.size >= maxPageLinks)) return raw;
    links.add(url);
    taken = true;
    return "";
  });
  return {
    links: [...links].slice(0, maxPageLinks),
    remainder: taken ? remainder.replace(/[ \t]{2,}/g, " ").trim() : text,
  };
}

export function refersToPage(question: string) {
  return (
    /\b(?:this|that|these|those|both|attached|pasted|above|same|previous|(?:the\s+)?(?:first|second|third|fourth))\s+(?:links?|pages?|articles?|docs?|documents?|urls?)\b/i.test(
      question,
    ) || /\b(?:the|those|these)\s+(?:links?|urls?)\b/i.test(question)
  );
}

export function resolvePageLinks(
  messages: Message[],
  runId: string,
  question: string,
) {
  const userTurns = messages.filter((message) => message.role === "user");
  const currentIndex = userTurns.findIndex(
    (message) => message.runId === runId,
  );
  if (currentIndex < 0) return [];
  const direct = userTurns[currentIndex].links;
  if (direct?.length) return direct;
  if (!refersToPage(question)) return [];
  const previous =
    userTurns
      .slice(0, currentIndex)
      .findLast((message) => message.links?.length)?.links ?? [];
  const ordinal =
    /\b(first|second|third|fourth)\s+(?:link|page|article|doc|document|url)\b/i
      .exec(question)?.[1]
      .toLowerCase();
  if (!ordinal) return previous;
  const selected =
    previous[["first", "second", "third", "fourth"].indexOf(ordinal)];
  return selected ? [selected] : [];
}

export function attachedPageNote(urls: string[]) {
  if (!urls.length) return "";
  const list = urls.map((url, index) => `${index + 1}. ${url}`).join("\n");
  return `Attached public pages for this turn, in the user's order:\n${list}\nOpen an exact attached URL before answering about that page. A snippet or a different page on the same domain is not the attachment. Cite the exact attached URL for claims about it. If the page cannot be read, say so. A question about other writing on the topic may use additional sources, and those must be labeled separately from the attachment.`;
}
