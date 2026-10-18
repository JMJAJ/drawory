import { pool } from "@/lib/server/db";
import { boardIdFrom, cleanString, handler, HttpError } from "@/lib/server/http";

type Ctx = { params: Promise<{ boardId: string }> };

/** Posts a chat message. Everyone in the room gets it through the `chat` live query. */
export const POST = handler<Ctx>(async (req, { params }) => {
  const boardId = boardIdFrom((await params).boardId);
  const b = await req.json();
  const body = cleanString(b.body, 2000).trim();
  if (!body) throw new HttpError(400, "Write something first");
  const userId = cleanString(b.user_id, 64);
  if (!userId) throw new HttpError(400, "Missing user");
  const { rows } = await pool.query(
    "insert into messages (board_id, user_id, name, color, body) values ($1, $2, $3, $4, $5) returning id::text, created_at",
    [boardId, userId, cleanString(b.name, 40, "Someone"), cleanString(b.color, 20, "#2F6BD0"), body],
  );
  return Response.json(rows[0], { status: 201 });
});
