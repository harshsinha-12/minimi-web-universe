import { ownerSession, assertOrigin } from "@/server/session";
import { getStore } from "@/db/store";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const owner = await ownerSession();
    const store = await getStore();
    const id = store.createConversation(owner);
    await store.flush();
    return Response.json({ id });
  } catch {
    return Response.json(
      { error: "Could not create the conversation" },
      { status: 400 },
    );
  }
}
