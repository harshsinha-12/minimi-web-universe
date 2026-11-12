import { cleanupContextCache } from "@/cache/redis";
import { dataControlError, editedText } from "@/server/data-controls";
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
    const store = getStore();
    store.forget(owner, id);
    await cleanupContextCache(store, owner);
    return Response.json({ ok: true });
  } catch (error) {
    return dataControlError(error);
  }
}
export async function POST(request: Request) {
  assertOrigin(request);
  const owner = await ownerSession();
  getStore().schedule(owner, true);
  return Response.json({ ok: true });
}

export async function PATCH(request: Request) {
  try {
    assertOrigin(request);
    const { id, text } = z
      .object({ id: z.uuid(), text: editedText })
      .parse(await request.json());
    const owner = await ownerSession();
    const store = getStore();
    const memory = store.editMemory(owner, id, text);
    await cleanupContextCache(store, owner);
    return Response.json({ memory });
  } catch (error) {
    return dataControlError(error);
  }
}
