import { randomInt } from "node:crypto";
import { pool, requireBoard } from "@/lib/server/db";
import { boardIdFrom, handler, VIEW_PREFIX } from "@/lib/server/http";

type Ctx = { params: Promise<{ boardId: string }> };

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** Makes (or returns) the room's view-only code. reset: true makes a new one, so old links stop working. */
export const POST = handler<Ctx>(async (req, { params }) => {
  const boardId = boardIdFrom((await params).boardId);
  await requireBoard(boardId);
  const body = await req.json().catch(() => ({}));
  if (body?.off === true) {
    await pool.query("update boards set view_code = null where id = $1", [boardId]);
    return Response.json({ code: null });
  }
  const { rows } = await pool.query("select view_code from boards where id = $1", [boardId]);
  if (rows[0]?.view_code && body?.reset !== true) return Response.json({ code: rows[0].view_code });
  const code = VIEW_PREFIX + Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  await pool.query("update boards set view_code = $2 where id = $1", [boardId, code]);
  return Response.json({ code });
});
