import { pool } from "@/lib/server/db";
import { handler, HttpError, UUID } from "@/lib/server/http";

type Ctx = { params: Promise<{ id: string }> };

/** Serves stored media, with Range support so audio and video can seek. */
export const GET = handler<Ctx>(async (req, { params }) => {
  const { id } = await params;
  if (!UUID.test(id)) throw new HttpError(404, "Not found");
  const meta = await pool.query("select mime, size from media where id = $1", [id]);
  if (!meta.rows[0]) throw new HttpError(404, "Not found");
  const { mime, size } = meta.rows[0] as { mime: string; size: number };

  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=31536000, immutable",
  };

  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const { rows } = await pool.query("select substring(bytes from $2 for $3) as chunk from media where id = $1", [
      id,
      start + 1,
      end - start + 1,
    ]);
    return new Response(new Uint8Array(rows[0].chunk as Buffer), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }

  const { rows } = await pool.query("select bytes from media where id = $1", [id]);
  return new Response(new Uint8Array(rows[0].bytes as Buffer), {
    headers: { ...headers, "Content-Length": String(size) },
  });
});
