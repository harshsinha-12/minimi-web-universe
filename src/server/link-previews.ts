import { Parser } from "htmlparser2";
import { createHash } from "node:crypto";
import type { Message } from "../types";
import { pageFingerprint } from "./page-text";
import { fetchPreviewResource, previewURL } from "./preview-fetch";
import { previewSentiment, type SentimentLabel } from "./source-chips";

export type LinkPreview = {
  url: string;
  title: string;
  description: string;
  domain: string;
  image: string | null;
  excerpt: string;
  textHash: string;
  sentiment: { label: SentimentLabel; reason: string };
};
export type FetchedPreview = LinkPreview & {
  etag: string | null;
  lastModified: string | null;
  fetchedAt: string;
};
export function extractPreview(html: string, page: string): LinkPreview {
  const meta = new Map<string, string>();
  let title = "",
    inTitle = false;
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === "meta") {
          const key = (attrs.property || attrs.name || "").toLowerCase();
          if (attrs.content && !meta.has(key)) meta.set(key, attrs.content);
        }
        if (name === "title") inTitle = true;
      },
      ontext(value) {
        if (inTitle) title += value;
      },
      onclosetag(name) {
        if (name === "title") inTitle = false;
      },
    },
    { decodeEntities: true },
  );
  parser.end(html);
  let image: string | null = null;
  try {
    const raw =
      meta.get("og:image:secure_url") ||
      meta.get("og:image") ||
      meta.get("twitter:image");
    if (raw) image = previewURL(raw, page).href;
  } catch {
    /* Text fallback for invalid images. */
  }
  const resolvedTitle = (
    meta.get("og:title") ||
    meta.get("twitter:title") ||
    title ||
    new URL(page).hostname
  ).slice(0, 220);
  const description = (
    meta.get("og:description") ||
    meta.get("description") ||
    ""
  ).slice(0, 320);
  const fingerprint = pageFingerprint(html);
  return {
    url: page,
    domain: new URL(page).hostname.replace(/^www\./, ""),
    title: resolvedTitle,
    description,
    image,
    excerpt: fingerprint.excerpt,
    textHash: fingerprint.hash,
    sentiment: previewSentiment(resolvedTitle, description),
  };
}
export function previewSources(message: Message) {
  return [
    ...new Map(
      [...message.citations, ...message.sources].map((source) => [
        source.url,
        source,
      ]),
    ).values(),
  ].slice(0, 3);
}
// Bounded, public-metadata cache. It contains no private conversation text or cookies.
const previews = new Map<
  string,
  { expires: number; promise: Promise<FetchedPreview> }
>();
export function linkPreview(raw: string) {
  const url = previewURL(raw).href;
  const key = createHash("sha256").update(url).digest("hex");
  const old = previews.get(key);
  if (old && old.expires > Date.now()) return old.promise;
  const promise = fetchPreviewResource(
    url,
    "html",
    AbortSignal.timeout(4000),
  ).then((result) => ({
    ...extractPreview(result.body.toString("utf8"), result.url),
    etag: result.etag,
    lastModified: result.lastModified,
    fetchedAt: new Date().toISOString(),
  }));
  if (previews.size >= 128) previews.delete(previews.keys().next().value!);
  previews.set(key, { expires: Date.now() + 300000, promise });
  return promise;
}
export function retainPreviewObservation(
  preview: FetchedPreview,
  stored: { fetchedAt: string } | null,
) {
  const storedAt = stored ? Date.parse(stored.fetchedAt) : Number.NaN;
  const previewAt = Date.parse(preview.fetchedAt);
  if (Number.isFinite(storedAt) && storedAt > previewAt) return null;
  return {
    url: preview.url,
    etag: preview.etag,
    lastModified: preview.lastModified,
    textHash: preview.textHash,
    title: preview.title,
    excerpt: preview.excerpt,
    fetchedAt: preview.fetchedAt,
  };
}
