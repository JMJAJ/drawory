import { pool } from "@/lib/server/db";
import { boardIdFrom, handler, HttpError } from "@/lib/server/http";

type Ctx = { params: Promise<{ boardId: string }> };
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = /^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm|quicktime)|audio\/(webm|ogg|mpeg|mp4|wav|x-m4a|aac))(;.*)?$/;

/** Stores an uploaded photo, video or voice note and returns its URL. */
export const POST = handler<Ctx>(async (req, { params }) => {
  const boardId = boardIdFrom((await params).boardId);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "No file");
  if (file.size > MAX_BYTES) throw new HttpError(413, "Files can be up to 25 MB");
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED.test(mime)) throw new HttpError(415, "That file type isn't supported");

  const id = crypto.randomUUID();
  const bytes = Buffer.from(await file.arrayBuffer());
  await pool.query("insert into media (id, board_id, mime, name, size, bytes) values ($1, $2, $3, $4, $5, $6)", [
    id,
    boardId,
    mime.split(";")[0],
    file.name.slice(0, 200),
    bytes.length,
    bytes,
  ]);
  // Tidy up: uploads that never made it onto the board (closed dialog, failed add) are dropped
  // after a day. Anything that was ever on the board stays, so Memory Lane can still show it.
  void pool
    .query(
      `delete from media m where m.board_id = $1 and m.created_at < now() - interval '1 day'
         and not exists (select 1 from element_events e where e.board_id = m.board_id and e.data->>'src' = '/api/media/' || m.id::text)`,
      [boardId],
    )
    .catch((e) => console.error("media cleanup", e));
  return Response.json({ id, url: `/api/media/${id}`, mime });
});
