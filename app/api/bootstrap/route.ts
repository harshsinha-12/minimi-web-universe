import { ownerSession } from "@/server/session";
import { getStore } from "@/db/store";
import { settings } from "@/config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const owner = await ownerSession();
    const store = await getStore();
    return Response.json({
      conversations: store.conversations(owner),
      memories: store.memories(owner),
      model: settings.model,
      reasoningEffort: settings.reasoning?.effort,
      memoryEnabled: settings.memoryEnabled,
      redisConfigured: Boolean(process.env.REDIS_HOST),
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Database unavailable",
      },
      { status: 500 },
    );
  }
}
