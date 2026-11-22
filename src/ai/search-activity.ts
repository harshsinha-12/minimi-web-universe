type SearchAction = {
  type?: string;
  queries?: string[];
  query?: string;
  url?: string | null;
  pattern?: string;
  sources?: { url?: string }[];
};

function clip(value: string, max = 90) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function searchActivity(action: SearchAction | null | undefined) {
  if (!action?.type) return null;
  if (action.type === "search") {
    const queries = [
      ...new Set([
        ...(action.queries ?? []),
        ...(action.query ? [action.query] : []),
      ]),
    ]
      .map((query) => clip(query))
      .filter(Boolean);
    const hosts = [
      ...new Set(
        (action.sources ?? [])
          .map((source) => host(source.url ?? ""))
          .filter(Boolean),
      ),
    ].slice(0, 3);
    if (!queries.length && !hosts.length) return null;
    const looking = queries.length
      ? `Searching “${queries[0]}”${queries.length > 1 ? ` and ${queries.length - 1} more` : ""}`
      : "Searching the web";
    return hosts.length ? `${looking} · ${hosts.join(", ")}` : looking;
  }
  if (action.type === "open_page" && action.url)
    return `Opening ${host(action.url) || clip(action.url, 80)}`;
  if (action.type === "find_in_page" && action.pattern) {
    const page = action.url ? host(action.url) : "";
    const pattern = clip(action.pattern, 60);
    return page ? `Finding “${pattern}” in ${page}` : `Finding “${pattern}”`;
  }
  return null;
}
