import type { Citation } from "../types";

const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function chatReference(thread: string, message?: string) {
  return `/?thread=${encodeURIComponent(thread)}${message ? `#message-${encodeURIComponent(message)}` : ""}`;
}

export function parseChatReference(href: string) {
  if (!href.startsWith("/?")) return null;
  const url = new URL(href, "https://minimi.invalid");
  const thread = url.searchParams.get("thread");
  const raw = /^#message[-=](.+)$/.exec(url.hash)?.[1];
  let message = raw;
  try {
    if (raw) message = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (
    !thread ||
    !idPattern.test(thread) ||
    (url.hash && (!message || !idPattern.test(message)))
  )
    return null;
  return { thread, message };
}

export function groundChatReferences(
  answer: string,
  messages: { id: string; conversationId: string }[],
  citations: Citation[] = [],
) {
  const owned = new Set(
    messages.map((message) => `${message.conversationId}\n${message.id}`),
  );
  const edits: { start: number; end: number; next: string }[] = [];
  for (const match of answer.matchAll(
    /\[([^\]\n]+)\]\((\/\?thread=([\w-]+)#message[-=]([\w-]+))\)/g,
  )) {
    const full = match[0];
    const label = match[1];
    const thread = match[3];
    const message = match[4];
    if (match.index === undefined || owned.has(`${thread}\n${message}`))
      continue;
    edits.push({
      start: match.index,
      end: match.index + full.length,
      next: label,
    });
  }
  let text = answer;
  for (const edit of [...edits].reverse())
    text = text.slice(0, edit.start) + edit.next + text.slice(edit.end);
  return {
    text,
    citations: citations.flatMap((citation) => {
      if (
        edits.some(
          (edit) => edit.start < citation.end && edit.end > citation.start,
        )
      )
        return [];
      const delta = edits
        .filter((edit) => edit.end <= citation.start)
        .reduce(
          (sum, edit) => sum + (edit.end - edit.start - edit.next.length),
          0,
        );
      return [
        {
          ...citation,
          start: citation.start - delta,
          end: citation.end - delta,
        },
      ];
    }),
  };
}
