import { ensureBoard, pool } from "@/lib/server/db";
import { boardIdFrom, cleanString, handler, HttpError } from "@/lib/server/http";

type Ctx = { params: Promise<{ boardId: string }> };

async function readBoard(boardId: string) {
  const { rows } = await pool.query(
    "select id, name, to_char(together_since, 'YYYY-MM-DD') as together_since from boards where id = $1",
    [boardId],
  );
  return rows[0];
}

export const GET = handler<Ctx>(async (_req, { params }) => {
  const boardId = boardIdFrom((await params).boardId);
  await ensureBoard(boardId);
  return Response.json(await readBoard(boardId));
});

export const PATCH = handler<Ctx>(async (req, { params }) => {
  const boardId = boardIdFrom((await params).boardId);
  const body = await req.json();
  const name = body.name === undefined ? null : cleanString(body.name, 80).trim() || "Our universe";
  let since: string | null | undefined = undefined;
  if (body.together_since !== undefined) {
    since = body.together_since === null || body.together_since === "" ? null : String(body.together_since);
    if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new HttpError(400, "Use a YYYY-MM-DD date");
  }
  await pool.query(
    `update boards set
       name = coalesce($2, name),
       together_since = case when $3::boolean then $4::date else together_since end
     where id = $1`,
    [boardId, name, since !== undefined, since ?? null],
  );
  // Tell the other person's board to refetch settings.
  await pool.query("insert into signals (board_id, kind, from_user) values ($1, 'board', $2)", [
    boardId,
    cleanString(body.from, 64, "someone"),
  ]);
  return Response.json(await readBoard(boardId));
});
