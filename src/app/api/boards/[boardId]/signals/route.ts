import { pool } from "@/lib/server/db";
import { boardIdFrom, cleanString, handler, HttpError } from "@/lib/server/http";

type Ctx = { params: Promise<{ boardId: string }> };
// "heart" is kept so older open tabs still work; new ones send "wave".
const KINDS = ["wave", "heart", "yt"];

/** Ephemeral nudges (waves, synced video controls). Old ones are pruned as new ones arrive. */
export const POST = handler<Ctx>(async (req, { params }) => {
  const boardId = boardIdFrom((await params).boardId);
  const b = await req.json();
  if (!KINDS.includes(b.kind)) throw new HttpError(400, "Unknown signal");
  const payload = b.payload && typeof b.payload === "object" ? b.payload : {};
  if (JSON.stringify(payload).length > 2000) throw new HttpError(413, "Signal too large");

  await pool.query(
    `with pruned as (
       delete from signals where board_id = $1 and created_at < now() - interval '1 day'
     )
     insert into signals (board_id, kind, from_user, payload) values ($1, $2, $3, $4)`,
    [boardId, b.kind, cleanString(b.from, 64, "someone"), JSON.stringify(payload)],
  );
  return new Response(null, { status: 204 });
});
