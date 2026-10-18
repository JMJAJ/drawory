import { serveFromDiscord } from "@/lib/server/discordCache";
import { handler, HttpError } from "@/lib/server/http";
import { discordStickerUrl, STICKERS } from "@/lib/stickers";

type Ctx = { params: Promise<{ file: string }> };

// Only the built-in stickers, so this can't be used to fetch anything else.
const KNOWN = new Set(STICKERS.map((s) => s.url.split("/").pop()!));

/** Serves a built-in sticker from the database, copying it from Discord the first time. */
export const GET = handler<Ctx>(async (_req, { params }) => {
  const { file } = await params;
  if (!KNOWN.has(file)) throw new HttpError(404, "Not found");
  return serveFromDiscord(file, discordStickerUrl(file));
});
