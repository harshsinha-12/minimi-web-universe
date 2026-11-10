import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { getStore } from "../db/store";
export async function ownerSession() {
  const jar = await cookies();
  let token = jar.get("minimi-session")?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    token = randomBytes(32).toString("hex");
    jar.set("minimi-session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  const owner = createHash("sha256").update(token).digest("hex");
  getStore().owner(owner);
  return owner;
}
export { assertOrigin } from "./origin";
