import { pool, readableBoard } from "@/lib/server/db";
import { handler } from "@/lib/server/http";

type Ctx = { params: Promise<{ boardId: string }> };

/** Every change ever made to the board, oldest first, for Memory Lane replay. */
export const GET = handler<Ctx>(async (_req, { params }) => {
  const boardId = await readableBoard((await params).boardId);
  const { rows } = await pool.query(
    `select id::text, element_id::text, op, type, data, z, author, created_at
     from element_events where board_id = $1 order by id asc limit 20000`,
    [boardId],
  );
  return Response.json(rows, { headers: { "Cache-Control": "no-store" } });
});
