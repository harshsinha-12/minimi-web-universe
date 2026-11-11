import type { Citation, Source } from "../types";

const brands: Record<string, string> = {
  "linkedin.com": "LinkedIn",
  "twitter.com": "Twitter",
  "x.com": "X",
  "reddit.com": "Reddit",
  "rediff.com": "Rediff",
  "rediffmail.com": "Rediffmail",
  "indiatimes.com": "Times of India",
  "timesofindia.com": "Times of India",
  "thehindu.com": "The Hindu",
  "ndtv.com": "NDTV",
  "bbc.com": "BBC",
  "bbc.co.uk": "BBC",
  "nytimes.com": "The New York Times",
  "theguardian.com": "The Guardian",
  "wikipedia.org": "Wikipedia",
  "github.com": "GitHub",
  "youtube.com": "YouTube",
  "medium.com": "Medium",
  "substack.com": "Substack",
  "openai.com": "OpenAI",
  "projectminimi.com": "minimi",
  "razorpay.com": "Razorpay",
  "indianexpress.com": "Indian Express",
};

export function sourceName(url: string, title?: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    const labels = host.split(".").filter(Boolean);
    for (let i = 0; i < labels.length - 1; i++) {
      const known = brands[labels.slice(i).join(".")];
      if (known) return known;
    }
    const stem = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
    if (!stem) return title?.slice(0, 40) || "Source";
    if (stem.length <= 3) return stem.toUpperCase();
    return stem.charAt(0).toUpperCase() + stem.slice(1);
  } catch {
    return title?.slice(0, 40) || "Source";
  }
}

export function oneLine(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

function canonical(url: string) {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.href.replace(/\/$/, "");
}

export function sourceList(
  sources: Source[],
  citations: Citation[] = [],
  limit = 12,
) {
  const seen = new Set<string>();
  const items: Source[] = [];
  const add = (url: string, title: string) => {
    let key = "";
    try {
      key = canonical(url);
    } catch {
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ url, title });
  };
  for (const citation of citations) add(citation.url, citation.title);
  for (const source of sources) add(source.url, source.title);
  return items.slice(0, limit);
}
export function pillSources(sources: Source[], citations: Citation[] = []) {
  return sourceList(sources, citations, 6);
}
