import { ownerSession } from "@/server/session";
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
