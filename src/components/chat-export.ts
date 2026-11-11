import { sourceName } from "../ai/source-label";

type ExportMessage = {
  role: string;
  content: string;
  citations?: { url: string; title: string }[];
  sources?: { url: string; title: string }[];
};

function sourceLines(message: ExportMessage) {
  const seen = new Set<string>();
  const lines: string[] = [];
  const add = (url: string, title?: string) => {
    let href = "";
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      href = parsed.href;
    } catch {
      return;
    }
    if (seen.has(href)) return;
    seen.add(href);
    const name = sourceName(url, title);
    const detail =
      title && title !== name && !title.includes("://")
        ? `${name}: ${title}`
        : name;
    lines.push(`- [${detail.replace(/[\[\]]/g, "")}](${href})`);
  };
  for (const citation of message.citations ?? [])
    add(citation.url, citation.title);
  for (const source of message.sources ?? []) add(source.url, source.title);
  return lines;
}

export function formatAnswer(message: ExportMessage) {
  const body = message.content.trim();
  const lines = message.role === "user" ? [] : sourceLines(message);
  if (!lines.length) return body;
  return `${body}\n\nSources\n${lines.join("\n")}`.trim();
}

export function formatChat(messages: ExportMessage[]) {
  return messages
    .filter(
      (message) =>
        message.content.trim() ||
        message.citations?.length ||
        message.sources?.length,
    )
    .map((message) => {
      const who = message.role === "user" ? "You" : "minimi";
      return `${who}\n${formatAnswer(message)}`;
    })
    .join("\n\n");
}

export function chatFileName(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${slug || "minimi-chat"}.md`;
}
