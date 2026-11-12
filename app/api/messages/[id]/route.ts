import { z } from "zod";
import { editedText } from "@/server/data-controls";
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
  const row = getStore()
    .db.prepare("SELECT conversation_id FROM messages WHERE owner=? AND id=?")
    .get(owner, id) as { conversation_id: string } | undefined;
  return row
    ? Response.json({ conversationId: row.conversation_id })
    : Response.json({ error: "Message not found" }, { status: 404 });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertOrigin(request);
    const { content } = z
      .object({ content: editedText })
      .parse(await request.json());
    const owner = await ownerSession();
    const { id } = await context.params;
    const store = getStore();
    const message = store.editMessage(owner, id, content);
    await cleanupContextCache(store, owner);
    return Response.json({ message });
  } catch (error) {
    return dataControlError(error);
  }
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
    store.deleteMessage(owner, id);
    await cleanupContextCache(store, owner);
    return Response.json({ ok: true });
  } catch (error) {
    return dataControlError(error);
  }
}
