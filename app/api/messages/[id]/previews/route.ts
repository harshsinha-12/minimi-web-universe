import { ownerSession } from "@/server/session";
import { getStore } from "@/db/store";
import { linkPreview, previewSources } from "@/server/link-previews";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const owner = await ownerSession();
  const { id } = await context.params;
  const message = getStore().message(owner, id);
  if (!message)
    return Response.json({ error: "Message not found" }, { status: 404 });
  const results = await Promise.allSettled(
    previewSources(message).map(async (source, i) => {
      const preview = await linkPreview(source.url);
      return {
        ...preview,
        image: preview.image
          ? `/api/messages/${id}/preview-image?source=${i}`
          : null,
      };
    }),
  );
  return Response.json(
    {
      previews: results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      ),
    },
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}
