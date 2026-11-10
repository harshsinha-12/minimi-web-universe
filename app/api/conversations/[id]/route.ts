import { ownerSession } from "@/server/session";
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
