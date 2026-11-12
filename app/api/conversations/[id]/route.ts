import { cleanupContextCache } from "@/cache/redis";
import { dataControlError } from "@/server/data-controls";
import { ownerSession, assertOrigin } from "@/server/session";
import { getStore } from "@/db/store";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const owner = await ownerSession();
  const { id } = await context.params;
  const store = getStore();
  if (!store.conversation(owner, id))
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  return Response.json({ messages: store.messages(owner, id) });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertOrigin(request);
    const owner = await ownerSession();
    const { id } = await context.params;
    const store = getStore();
    store.deleteConversation(owner, id);
    await cleanupContextCache(store, owner);
    return Response.json({ ok: true });
  } catch (error) {
    return dataControlError(error);
  }
}
