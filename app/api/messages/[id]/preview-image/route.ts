import { ownerSession } from "@/server/session";
import { getStore } from "@/db/store";
import { linkPreview, previewSources } from "@/server/link-previews";
import { fetchPreviewResource } from "@/server/preview-fetch";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const owner = await ownerSession();
  const { id } = await context.params;
  const message = getStore().message(owner, id);
  const raw = new URL(request.url).searchParams.get("source");
  const index = raw && /^[0-2]$/.test(raw) ? Number(raw) : -1;
  const source = message && previewSources(message)[index];
  if (!source) return new Response(null, { status: 404 });
  try {
    const preview = await linkPreview(source.url);
    if (!preview.image) return new Response(null, { status: 404 });
    const result = await fetchPreviewResource(
      preview.image,
      "image",
      AbortSignal.timeout(4000),
    );
    return new Response(new Uint8Array(result.body), {
      headers: {
        "Content-Type": result.type,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
