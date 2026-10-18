import { pool } from "@/lib/server/db";
import { boardIdFrom, cleanString, finiteNumber, handler, HttpError, UUID } from "@/lib/server/http";

type Ctx = { params: Promise<{ boardId: string }> };

/**
 * Seals a new time capsule. The message goes to capsule_items, which no live query reads,
 * so the board only ever sees the envelope until the unlock date.
 */
export const POST = handler<Ctx>(async (req, { params }) => {
  const boardId = boardIdFrom((await params).boardId);
  const b = await req.json();
  const id = String(b.id ?? "");
  if (!UUID.test(id)) throw new HttpError(400, "Bad id");
  const unlockAt = new Date(String(b.unlockAt));
  if (Number.isNaN(unlockAt.getTime())) throw new HttpError(400, "Pick an unlock date");
  if (unlockAt.getTime() < Date.now() + 60_000) throw new HttpError(400, "Pick a date in the future");
  const message = cleanString(b.body, 10_000).trim();
  if (!message) throw new HttpError(400, "Write something to seal inside");
  const author = cleanString(b.author, 64, "someone");
  const authorName = cleanString(b.authorName, 40, "Someone");

  const data = {
    x: finiteNumber(b.x),
    y: finiteNumber(b.y),
    w: 300,
    title: cleanString(b.title, 120).trim() || "Time capsule",
    page: cleanString(b.page, 24) || undefined,
    unlockAt: unlockAt.toISOString(),
    sealedByName: authorName,
    count: 1,
  };

  const { rows } = await pool.query(
    `with el as (
       insert into elements (id, board_id, type, data, z, created_by) values ($2, $1, 'capsule', $3, $4, $5)
       returning id
     ),
     cap as (insert into capsules (element_id, board_id, unlock_at) values ($2, $1, $6)),
     item as (insert into capsule_items (id, board_id, element_id, author, author_name, body) values ($7, $1, $2, $5, $8, $9)),
     ev as (
       insert into element_events (board_id, element_id, op, type, data, z, author)
       values ($1, $2, 'upsert', 'capsule', $3, $4, $5)
       returning pg_current_xact_id()::text as txid
     )
     select txid from ev`,
    [boardId, id, JSON.stringify(data), finiteNumber(b.z), author, unlockAt.toISOString(), crypto.randomUUID(), authorName, message],
  );
  return Response.json({ kind: "committed", txid: rows[0]?.txid ?? null });
});
