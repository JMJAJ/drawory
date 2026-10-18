import { discordEmojiUrl, EMOJI_FILES } from "@/lib/emojis";
import { serveFromDiscord } from "@/lib/server/discordCache";
import { handler, HttpError } from "@/lib/server/http";

type Ctx = { params: Promise<{ file: string }> };

/** Serves a built-in chat emoji from the database, copying it from Discord the first time. */
export const GET = handler<Ctx>(async (_req, { params }) => {
  const { file } = await params;
  if (!EMOJI_FILES.has(file)) throw new HttpError(404, "Not found");
  return serveFromDiscord(`emoji/${file}`, discordEmojiUrl(file));
});
