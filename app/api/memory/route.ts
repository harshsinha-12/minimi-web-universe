import { z } from "zod";
import { ownerSession, assertOrigin } from "@/server/session";
import { getStore } from "@/db/store";
export const runtime = "nodejs";
export async function GET() {
  const owner = await ownerSession();
  return Response.json({ memories: getStore().memories(owner) });
}
export async function DELETE(request: Request) {
  try {
    assertOrigin(request);
    const { id } = z.object({ id: z.uuid() }).parse(await request.json());
    const owner = await ownerSession();
    getStore().forget(owner, id);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Memory not found" }, { status: 404 });
  }
}
export async function POST(request: Request) {
  assertOrigin(request);
  const owner = await ownerSession();
  getStore().schedule(owner, true);
  return Response.json({ ok: true });
}
