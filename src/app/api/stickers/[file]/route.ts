import { pool } from "@/lib/server/db";
import { handler, HttpError } from "@/lib/server/http";
import { discordStickerUrl, STICKERS } from "@/lib/stickers";

type Ctx = { params: Promise<{ file: string }> };

// Only the built-in stickers, so this can't be used to fetch anything else.
const KNOWN = new Set(STICKERS.map((s) => s.url.split("/").pop()!));

declare global {
  var __draworyStickerTable: Promise<unknown> | undefined;
}

// Created on first use too, so a deploy that skipped `npm run db:migrate` still works.
function ensureTable() {
  globalThis.__draworyStickerTable ??= pool
    .query(
      `create table if not exists sticker_cache (
         file text primary key, mime text not null, bytes bytea not null, created_at timestamptz not null default now()
       )`,
    )
    .catch((e) => {
      globalThis.__draworyStickerTable = undefined;
      throw e;
    });
  return globalThis.__draworyStickerTable;
}

const headers = (mime: string) => ({ "Content-Type": mime, "Cache-Control": "private, max-age=31536000, immutable" });

/** Serves a built-in sticker from the database, copying it from Discord the first time. */
export const GET = handler<Ctx>(async (_req, { params }) => {
  const { file } = await params;
  if (!KNOWN.has(file)) throw new HttpError(404, "Not found");
  await ensureTable();

  const cached = await pool.query("select mime, bytes from sticker_cache where file = $1", [file]);
  if (cached.rows[0]) return new Response(new Uint8Array(cached.rows[0].bytes as Buffer), { headers: headers(cached.rows[0].mime) });

  const res = await fetch(discordStickerUrl(file), { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const mime = res?.headers.get("content-type")?.split(";")[0] ?? "";
  if (!res?.ok || !mime.startsWith("image/")) throw new HttpError(502, "Couldn't load that sticker");
  const bytes = Buffer.from(await res.arrayBuffer());
  await pool.query("insert into sticker_cache (file, mime, bytes) values ($1, $2, $3) on conflict (file) do nothing", [file, mime, bytes]);
  return new Response(new Uint8Array(bytes), { headers: headers(mime) });
});
