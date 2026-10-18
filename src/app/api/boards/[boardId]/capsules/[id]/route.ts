import { pool } from "@/lib/server/db";
import { boardIdFrom, cleanString, handler, HttpError, UUID } from "@/lib/server/http";

type Ctx = { params: Promise<{ boardId: string; id: string }> };

async function capsuleFor(boardId: string, id: string) {
  if (!UUID.test(id)) throw new HttpError(404, "Not found");
  const { rows } = await pool.query(
    "select unlock_at, unlock_at <= now() as unlocked from capsules where element_id = $1 and board_id = $2",
    [id, boardId],
  );
  if (!rows[0]) throw new HttpError(404, "Not found");
  return rows[0] as { unlock_at: Date; unlocked: boolean };
}

/** Opens a capsule. The server refuses until the unlock date, so peeking isn't possible. */
export const GET = handler<Ctx>(async (_req, { params }) => {
  const { boardId: rawBoard, id } = await params;
  const boardId = boardIdFrom(rawBoard);
  const capsule = await capsuleFor(boardId, id);
  if (!capsule.unlocked) {
    return Response.json({ unlocked: false, unlockAt: capsule.unlock_at }, { status: 403 });
  }
  const { rows } = await pool.query(
    "select id, author_name, body, created_at from capsule_items where element_id = $1 order by created_at",
    [id],
  );
  return Response.json({ unlocked: true, unlockAt: capsule.unlock_at, items: rows });
});

/** Slips another note into a sealed capsule. Only the count on the envelope changes. */
export const POST = handler<Ctx>(async (req, { params }) => {
  const { boardId: rawBoard, id } = await params;
  const boardId = boardIdFrom(rawBoard);
  await capsuleFor(boardId, id);
  const b = await req.json();
  const message = cleanString(b.body, 10_000).trim();
  if (!message) throw new HttpError(400, "Write something first");
  const author = cleanString(b.author, 64, "someone");

  const { rows } = await pool.query(
    `with item as (
       insert into capsule_items (id, board_id, element_id, author, author_name, body) values ($3, $1, $2, $4, $5, $6)
     ),
     up as (
       update elements
         set data = jsonb_set(data, '{count}', to_jsonb(coalesce((data->>'count')::int, 0) + 1)), updated_at = now()
       where id = $2 and board_id = $1
       returning id, type, data, z
     ),
     ev as (
       insert into element_events (board_id, element_id, op, type, data, z, author)
       select $1, id, 'upsert', type, data, z, $4 from up
       returning pg_current_xact_id()::text as txid
     )
     select txid from ev`,
    [boardId, id, crypto.randomUUID(), author, cleanString(b.authorName, 40, "Someone"), message],
  );
  return Response.json({ kind: "committed", txid: rows[0]?.txid ?? null });
});
