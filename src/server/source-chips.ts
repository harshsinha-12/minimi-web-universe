import type { Message } from "../types";

export type Chip = { label: string; tone: string; reason: string };
export type SentimentLabel =
  "positive" | "negative" | "mixed" | "neutral" | "unclear";
export type FreshnessLabel = "unchanged" | "changed" | "unchecked";

const positiveWords = new Set([
  "growth",
  "surge",
  "gains",
  "gain",
  "win",
  "wins",
  "breakthrough",
  "launch",
  "improve",
  "improved",
  "recovery",
  "profit",
  "profits",
  "upgrade",
  "success",
  "successful",
  "optimistic",
  "rally",
  "boost",
  "strong",
  "beats",
  "beat",
  "soars",
  "soar",
]);
const negativeWords = new Set([
  "plunge",
  "plunges",
  "lawsuit",
  "sued",
  "ban",
  "banned",
  "outage",
  "breach",
  "hack",
  "recall",
  "layoffs",
  "layoff",
  "loss",
  "losses",
  "decline",
  "declines",
  "crash",
  "crisis",
  "scandal",
  "fraud",
  "fined",
  "slump",
  "bankruptcy",
  "warning",
  "fell",
  "drop",
  "drops",
  "dropped",
  "sinks",
  "sink",
]);
const negations = new Set(["not", "no", "never", "without"]);

function wordsOf(value: string) {
  return value.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}
function negated(words: string[], index: number) {
  return words
    .slice(Math.max(0, index - 3), index)
    .some((word) => negations.has(word) || word.endsWith("n't"));
}
export function previewSentiment(title: string, description: string) {
  const text = `${title} ${description}`.replace(/\s+/g, " ").trim();
  const words = wordsOf(text);
  let positive = 0;
  let negative = 0;
  const hits: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const kind = positiveWords.has(word)
      ? "positive"
      : negativeWords.has(word)
        ? "negative"
        : null;
    if (!kind || negated(words, i)) continue;
    if (kind === "positive") positive++;
    else negative++;
    if (hits.length < 3) hits.push(word);
  }
  const cited = hits.length ? ` (${hits.join(", ")})` : "";
  let label: SentimentLabel = "unclear";
  if (positive > 0 && negative > 0) label = "mixed";
  else if (positive > 0) label = "positive";
  else if (negative > 0) label = "negative";
  else if (text.length >= 40) label = "neutral";
  const reason =
    label === "unclear"
      ? "The preview does not have enough wording to read a tone."
      : label === "neutral"
        ? "The preview wording has no clear positive or negative tone."
        : `The preview wording reads ${label}${cited}.`;
  return { label, reason };
}
export function pageFreshness(
  savedHash: string | null | undefined,
  currentHash: string | null | undefined,
): FreshnessLabel {
  if (!savedHash || !currentHash) return "unchecked";
  return savedHash === currentHash ? "unchanged" : "changed";
}
export function sourceConfidence(args: {
  cited: boolean;
  freshness: FreshnessLabel;
}) {
  if (args.freshness === "changed")
    return {
      level: "low" as const,
      reason:
        "The page text changed after it was saved, so this answer may be stale.",
    };
  if (args.cited && args.freshness === "unchanged")
    return {
      level: "high" as const,
      reason: "Cited in the answer, and the saved page text still matches.",
    };
  if (args.cited)
    return {
      level: "medium" as const,
      reason: "Cited in the answer. The page text has not been rechecked yet.",
    };
  if (args.freshness === "unchanged")
    return {
      level: "medium" as const,
      reason:
        "The page text matches the saved copy, but the answer did not cite it inline.",
    };
  return {
    level: "low" as const,
    reason:
      "Consulted, but not cited inline, and the page text has not been rechecked.",
  };
}
function samePage(left: string, right: string) {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return (
      a.protocol === b.protocol &&
      a.host === b.host &&
      a.pathname.replace(/\/$/, "") === b.pathname.replace(/\/$/, "") &&
      a.search === b.search
    );
  } catch {
    return left === right;
  }
}
const freshnessCopy: Record<FreshnessLabel, string> = {
  unchanged: "The visible page text matches the saved copy.",
  changed: "The visible page text changed after it was saved.",
  unchecked: "This page has not been checked against a saved copy yet.",
};
const freshnessLabel: Record<FreshnessLabel, string> = {
  unchanged: "Page · Unchanged",
  changed: "Page · Changed",
  unchecked: "Page · Not rechecked",
};
export function previewCard(
  message: Message,
  preview: {
    url: string;
    title: string;
    description: string;
    domain: string;
    image: string | null;
    textHash: string;
    sentiment: { label: SentimentLabel; reason: string };
  },
  observation: { textHash: string } | null,
) {
  const freshness = pageFreshness(observation?.textHash, preview.textHash);
  const cited = message.citations.some((item) =>
    samePage(item.url, preview.url),
  );
  const sentiment = preview.sentiment;
  const confidence = sourceConfidence({ cited, freshness });
  const chip = (label: string, tone: string, reason: string): Chip => ({
    label,
    tone,
    reason,
  });
  return {
    url: preview.url,
    title: preview.title,
    description: preview.description,
    domain: preview.domain,
    image: preview.image,
    sentiment: chip(
      `Tone · ${sentiment.label[0].toUpperCase()}${sentiment.label.slice(1)}`,
      sentiment.label,
      sentiment.reason,
    ),
    confidence: chip(
      `Confidence · ${confidence.level[0].toUpperCase()}${confidence.level.slice(1)}`,
      confidence.level,
      confidence.reason,
    ),
    freshness: chip(
      freshnessLabel[freshness],
      freshness,
      freshnessCopy[freshness],
    ),
  };
}
