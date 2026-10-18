import { pool } from "@/lib/server/db";
import { boardIdFrom, cleanString, finiteNumber, handler, HttpError, UUID } from "@/lib/server/http";

type Ctx = { params: Promise<{ boardId: string }> };

/** Upserts the caller's cursor, viewport and activity. Sent a few times a second while active. */
export const POST = handler<Ctx>(async (req, { params }) => {
  const boardId = boardIdFrom((await params).boardId);
  const b = await req.json();
  const userId = cleanString(b.user_id, 64);
  if (!userId) throw new HttpError(400, "Missing user");
  const watching = typeof b.watching === "string" && UUID.test(b.watching) ? b.watching : null;
  const nullable = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  await pool.query(
    `insert into presence (board_id, user_id, name, color, cursor_x, cursor_y, view_x, view_y, view_w, view_h, zoom, tool, watching, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
     on conflict (board_id, user_id) do update set
       name = excluded.name, color = excluded.color, cursor_x = excluded.cursor_x, cursor_y = excluded.cursor_y,
       view_x = excluded.view_x, view_y = excluded.view_y, view_w = excluded.view_w, view_h = excluded.view_h,
       zoom = excluded.zoom, tool = excluded.tool, watching = excluded.watching, updated_at = now()`,
    [
      boardId,
      userId,
      cleanString(b.name, 40, "Someone"),
      cleanString(b.color, 20, "#2F6BD0"),
      nullable(b.cursor_x),
      nullable(b.cursor_y),
      finiteNumber(b.view_x),
      finiteNumber(b.view_y),
      finiteNumber(b.view_w),
      finiteNumber(b.view_h),
      finiteNumber(b.zoom, 1),
      cleanString(b.tool, 20) || null,
      watching,
    ],
  );
  return new Response(null, { status: 204 });
});
