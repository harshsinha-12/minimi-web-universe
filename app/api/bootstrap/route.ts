import { ownerSession } from "@/server/session";
import { getStore } from "@/db/store";
import { settings } from "@/config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const owner = await ownerSession();
  const store = getStore();
  return Response.json({
    conversations: store.conversations(owner),
    memories: store.memories(owner),
    model: settings.model,
    memoryEnabled: settings.memoryEnabled,
    redisConfigured: Boolean(process.env.REDIS_HOST),
  });
}
