import { cleanString, handler, HttpError } from "@/lib/server/http";
import { nowListening } from "@/lib/server/spotify";

/** What I'm playing on Spotify right now ({ track: null } when nothing is). */
export const POST = handler(async (req) => {
  const b = await req.json().catch(() => ({}));
  const key = cleanString(b.key, 64);
  if (!key) throw new HttpError(400, "Missing key");
  return Response.json({ track: await nowListening(key) }, { headers: { "Cache-Control": "no-store" } });
});
