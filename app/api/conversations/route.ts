import { ownerSession, assertOrigin } from "@/server/session";
import { getStore } from "@/db/store";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const owner = await ownerSession();
    return Response.json({ id: getStore().createConversation(owner) });
  } catch {
    return Response.json(
      { error: "Could not create the conversation" },
      { status: 400 },
    );
  }
}
