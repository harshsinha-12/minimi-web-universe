export function isNewConversationShortcut(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey?: boolean;
  key: string;
  code?: string;
}) {
  if (event.altKey || !(event.metaKey || event.ctrlKey)) return false;
  return event.key.toLowerCase() === "k" || event.code === "KeyK";
}
