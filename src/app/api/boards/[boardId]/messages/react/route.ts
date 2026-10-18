import { REACTIONS } from "@/lib/reactions";
import { pool } from "@/lib/server/db";
import { boardIdFrom, cleanString, handler, HttpError } from "@/lib/server/http";

type Ctx = { params: Promise<{ boardId: string }> };

/** Adds or removes my reaction on a message, in one statement so simultaneous reactions all count. */
export const POST = handler<Ctx>(async (req, { params }) => {
  const boardId = boardIdFrom((await params).boardId);
  const b = await req.json();
  const id = String(b.id ?? "");
  if (!/^\d{1,18}$/.test(id)) throw new HttpError(400, "Bad message id");
  const emoji = String(b.emoji ?? "");
  if (!REACTIONS.includes(emoji)) throw new HttpError(400, "Pick one of the reactions");
  const user = cleanString(b.user_id, 64);
  if (!user) throw new HttpError(400, "Missing user");
  const { rowCount } = await pool.query(
    `update messages
        set reactions = case
          when coalesce(reactions -> $3, '[]'::jsonb) ? $4
            then case when jsonb_array_length((reactions -> $3) - $4) = 0 then reactions - $3 else jsonb_set(reactions, array[$3], (reactions -> $3) - $4) end
          else jsonb_set(reactions, array[$3], coalesce(reactions -> $3, '[]'::jsonb) || to_jsonb($4::text))
        end
      where board_id = $1 and id = $2`,
    [boardId, id, emoji, user],
  );
  if (!rowCount) throw new HttpError(404, "That message is gone");
  return Response.json({ ok: true });
});
