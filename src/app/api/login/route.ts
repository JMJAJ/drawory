import type { NextRequest } from "next/server";
import { authEnabled, isValidPasscode, SESSION_COOKIE, sessionToken } from "@/lib/auth";

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function POST(req: NextRequest) {
  if (!authEnabled()) return Response.json({ ok: true });
  const body = await req.json().catch(() => ({}));
  const passcode = typeof body?.passcode === "string" ? body.passcode : "";
  if (!(await isValidPasscode(passcode))) {
    // Slow down guessing a little.
    await new Promise((r) => setTimeout(r, 600));
    return Response.json({ error: "That passcode isn't right" }, { status: 401 });
  }
  const res = Response.json({ ok: true });
  const cookie = [
    `${SESSION_COOKIE}=${await sessionToken()}`,
    `Path=${cookieOptions.path}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${60 * 60 * 24 * 365}`,
    cookieOptions.secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
  res.headers.append("Set-Cookie", cookie);
  return res;
}

export async function DELETE() {
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res;
}
