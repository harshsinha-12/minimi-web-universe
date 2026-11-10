import { canonicalPageUrl, fetchPreviewResource } from "./preview-fetch";
import { pageFingerprint } from "./page-text";

export type PageObservation = {
  url: string;
  etag: string | null;
  lastModified: string | null;
  textHash: string;
  title: string;
  excerpt: string;
  fetchedAt: string;
};
export async function revalidatePage(
  raw: string,
  previous: PageObservation | null,
  signal: AbortSignal,
) {
  const canonical = canonicalPageUrl(raw);
  if (!canonical) return { state: "unavailable" as const, page: null };
  try {
    const result = await fetchPreviewResource(
      canonical,
      "html",
      signal,
      0,
      previous
        ? { etag: previous.etag, lastModified: previous.lastModified }
        : undefined,
    );
    const fetchedAt = new Date().toISOString();
    if (result.status === 304 && previous)
      return {
        state: "unchanged" as const,
        page: { ...previous, url: canonical, fetchedAt },
      };
    const fingerprint = pageFingerprint(result.body.toString("utf8"));
    const page: PageObservation = {
      url: canonical,
      etag: result.etag,
      lastModified: result.lastModified,
      textHash: fingerprint.hash,
      title: previous?.title || new URL(canonical).hostname,
      excerpt: fingerprint.excerpt,
      fetchedAt,
    };
    if (!previous) return { state: "unavailable" as const, page };
    return {
      state:
        previous.textHash === page.textHash
          ? ("unchanged" as const)
          : ("changed" as const),
      page,
    };
  } catch {
    return { state: "unavailable" as const, page: null };
  }
}
