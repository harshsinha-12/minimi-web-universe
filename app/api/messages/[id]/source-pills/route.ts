import { ownerSession } from "@/server/session";
import { getStore } from "@/db/store";
import { oneLine, pillSources, sourceName } from "@/ai/source-label";
import { linkPreview } from "@/server/link-previews";
import { logger } from "@/server/logger";

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
  const sources = pillSources(message.sources, message.citations);
  const results = await Promise.allSettled(
    sources.map(async (source, index) => {
      const name = sourceName(source.url, source.title);
      const stored =
        source.title && !/^[\w.-]+\.[a-z]{2,}$/i.test(source.title.trim())
          ? source.title
          : "";
      try {
        const preview = await linkPreview(source.url);
        const title =
          preview.title && preview.title !== preview.domain
            ? preview.title
            : stored || name;
        const description = oneLine(preview.description);
        return {
          index,
          url: source.url,
          name,
          title,
          description: description && description !== title ? description : "",
        };
      } catch (error) {
        logger.warn(
          { component: "preview", err: error },
          "source pill text skipped",
        );
        return {
          index,
          url: source.url,
          name,
          title: stored || name,
          description: "",
        };
      }
    }),
  );
  return Response.json(
    {
      pills: results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      ),
    },
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}
