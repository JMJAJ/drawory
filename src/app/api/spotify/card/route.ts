import { cleanString, handler, HttpError } from "@/lib/server/http";
import { CARD_ID, nowFromCard } from "@/lib/server/spotify";

/** What someone is playing, read from their public Data Card for Spotify ({ track: null } when nothing is). */
export const POST = handler(async (req) => {
  const b = await req.json().catch(() => ({}));
  const id = cleanString(b.user_id, 64);
  if (!CARD_ID.test(id)) throw new HttpError(400, "That isn't a Data Card link");
  return Response.json({ track: await nowFromCard(id) }, { headers: { "Cache-Control": "no-store" } });
});
