export function formatChat(messages: { role: string; content: string }[]) {
  return messages
    .filter((message) => message.content.trim())
    .map((message) => {
      const who = message.role === "user" ? "You" : "minimi";
      return `${who}\n${message.content.trim()}`;
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
