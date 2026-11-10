import { ownerSession } from "@/server/session";
import { getStore } from "@/db/store";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const owner = await ownerSession();
  const { id } = await context.params;
  const run = getStore().run(owner, id);
  return run
    ? Response.json(run)
    : Response.json({ error: "Run not found" }, { status: 404 });
}
