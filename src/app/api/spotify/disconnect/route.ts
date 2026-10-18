import { cleanString, handler } from "@/lib/server/http";
import { unlink } from "@/lib/server/spotify";

/** Forgets my Spotify sign-in on this site. */
export const POST = handler(async (req) => {
  const b = await req.json().catch(() => ({}));
  const key = cleanString(b.key, 64);
  if (key) await unlink(key);
  return Response.json({ ok: true });
});
