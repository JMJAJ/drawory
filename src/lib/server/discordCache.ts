import "server-only";
import { pool } from "@/lib/server/db";
import { HttpError } from "@/lib/server/http";

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

/**
 * Serves a picture from the database, copying it from Discord the first time (so stickers and
 * emojis keep working if Discord moves or removes them). key is how it's stored.
 */
export async function serveFromDiscord(key: string, source: string) {
  await ensureTable();
  const cached = await pool.query("select mime, bytes from sticker_cache where file = $1", [key]);
  if (cached.rows[0]) return new Response(new Uint8Array(cached.rows[0].bytes as Buffer), { headers: headers(cached.rows[0].mime) });

  const res = await fetch(source, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const mime = res?.headers.get("content-type")?.split(";")[0] ?? "";
  if (!res?.ok || !mime.startsWith("image/")) throw new HttpError(502, "Couldn't load that picture");
  const bytes = Buffer.from(await res.arrayBuffer());
  await pool.query("insert into sticker_cache (file, mime, bytes) values ($1, $2, $3) on conflict (file) do nothing", [key, mime, bytes]);
  return new Response(new Uint8Array(bytes), { headers: headers(mime) });
}
