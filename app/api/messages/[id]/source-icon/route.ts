import { ownerSession } from "@/server/session";
import { getStore } from "@/db/store";
import { pillSources } from "@/ai/source-label";
import { linkPreview } from "@/server/link-previews";
import { fetchPreviewResource, previewURL } from "@/server/preview-fetch";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const owner = await ownerSession();
  const { id } = await context.params;
  const message = getStore().message(owner, id);
  const raw = new URL(request.url).searchParams.get("source");
  const index = raw && /^\d+$/.test(raw) ? Number(raw) : -1;
  const source =
    message && pillSources(message.sources, message.citations)[index];
  if (!source) return new Response(null, { status: 404 });
  let page = source.url;
  try {
    page = previewURL(source.url).href;
  } catch {
    return new Response(null, { status: 404 });
  }
  const candidates: string[] = [];
  try {
    const preview = await linkPreview(page);
    if (preview.icon) candidates.push(preview.icon);
    page = preview.url;
  } catch {
    /* The article itself can block metadata while its logo still loads. */
  }
  try {
    candidates.push(previewURL(new URL("/favicon.ico", page).href).href);
  } catch {
    /* The page URL is not a usable icon base. */
  }
  try {
    const host = new URL(page).hostname;
    candidates.push(
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
    );
  } catch {
    /* Hostname could not be read. */
  }
  for (const candidate of candidates) {
    try {
      const result = await fetchPreviewResource(
        candidate,
        "icon",
        AbortSignal.timeout(4000),
      );
      return new Response(new Uint8Array(result.body), {
        headers: {
          "Content-Type": result.type,
          "Cache-Control": "private, max-age=86400",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
    } catch {
      /* Try the next logo candidate. */
    }
  }
  return new Response(null, { status: 404 });
}
