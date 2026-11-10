import { ownerSession } from "@/server/session";
import { getStore } from "@/db/store";
import { linkPreview, previewSources } from "@/server/link-previews";
import { logger } from "@/server/logger";
import { previewCard } from "@/server/source-chips";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const owner = await ownerSession();
  const { id } = await context.params;
  const store = getStore();
  const message = store.message(owner, id);
  if (!message)
    return Response.json({ error: "Message not found" }, { status: 404 });
  const sources = previewSources(message);
  const results = await Promise.allSettled(
    previewSources(message).map(async (source, i) => {
      const preview = await linkPreview(source.url);
      const observation = store.pageObservation(preview.url);
      const card = previewCard(
        message,
        {
          ...preview,
          image: preview.image
            ? `/api/messages/${id}/preview-image?source=${i}`
            : null,
        },
        observation,
      );
      store.savePageObservation({
        url: preview.url,
        etag: observation?.etag ?? null,
        lastModified: observation?.lastModified ?? null,
        textHash: preview.textHash,
        title: preview.title,
        excerpt: preview.excerpt,
        fetchedAt: new Date().toISOString(),
      });
      return card;
    }),
  );
  for (const result of results)
    if (result.status === "rejected")
      logger.warn(
        { component: "preview", err: result.reason, sources: sources.length },
        "source preview skipped",
      );
  return Response.json(
    {
      previews: results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      ),
    },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
