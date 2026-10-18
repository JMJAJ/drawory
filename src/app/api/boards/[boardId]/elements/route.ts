import { applyEdit, parseEdit, type Edit } from "@/lib/edits";
import { pool } from "@/lib/server/db";
import { boardIdFrom, cleanString, handler, HttpError, UUID } from "@/lib/server/http";
import type { ElementType } from "@/lib/types";

type Ctx = { params: Promise<{ boardId: string }> };

const TYPES: ElementType[] = [
  "stroke", "rect", "ellipse", "arrow", "text", "note", "image", "video",
  "audio", "youtube", "embed", "link", "capsule", "place", "sticker", "chatbox", "sticky", "window", "game",
];
const MAX_DATA = 400_000;
const MAX_OPS = 200;

/**
 * Applies a batch of element changes in ONE statement, so it's one transaction with one txid.
 * Every change is also appended to element_events for Memory Lane.
 */
export const POST = handler<Ctx>(async (req, { params }) => {
  const boardId = boardIdFrom((await params).boardId);
  const body = await req.json();
  const author = cleanString(body.author, 64) || null;
  if (!Array.isArray(body.ops) || body.ops.length === 0 || body.ops.length > MAX_OPS) {
    throw new HttpError(400, "Send between 1 and 200 ops");
  }

  const ops = body.ops.map((raw: Record<string, unknown>) => {
    const id = String(raw.id ?? "");
    if (!UUID.test(id)) throw new HttpError(400, "Bad element id");
    if (raw.op === "delete") return { id, op: "delete", type: null, data: null, z: null };
    if (raw.op === "edit") {
      const e = parseEdit(raw.edit);
      if (!e) throw new HttpError(400, "Bad edit");
      return { id, op: "edit", type: null, data: null, z: null, edit: e };
    }
    if (raw.op !== "upsert") throw new HttpError(400, "Bad op");
    const type = raw.type as ElementType;
    if (!TYPES.includes(type)) throw new HttpError(400, "Bad element type");
    if (!raw.data || typeof raw.data !== "object") throw new HttpError(400, "Missing data");
    if (JSON.stringify(raw.data).length > MAX_DATA) throw new HttpError(413, "Element too large");
    const z = typeof raw.z === "number" && Number.isFinite(raw.z) ? raw.z : 0;
    return { id, op: "upsert", type, data: raw.data, z };
  });

  const plain = ops.filter((o: { op: string }) => o.op !== "edit");
  const edits = ops.filter((o: { op: string }) => o.op === "edit") as { id: string; edit: Edit }[];
  const db = await pool.connect();
  try {
    await db.query("begin");
    if (plain.length) await applyBatch(db, boardId, plain, author);
    for (const { id, edit } of edits) {
      const { rows } = await db.query("select type, data, z from elements where board_id = $1 and id = $2 for update", [boardId, id]);
      if (!rows[0]) continue; // deleted meanwhile: nothing to change
      const data = applyEdit(rows[0].data, edit);
      if (JSON.stringify(data).length > MAX_DATA) throw new HttpError(413, "Element too large");
      await db.query("update elements set data = $3, updated_at = now() where board_id = $1 and id = $2", [boardId, id, data]);
      await db.query(
        "insert into element_events (board_id, element_id, op, type, data, z, author) values ($1, $2, 'upsert', $3, $4, $5, $6)",
        [boardId, id, rows[0].type, data, rows[0].z, author],
      );
    }
    const { rows } = await db.query("select pg_current_xact_id()::text as txid");
    await db.query("commit");
    return Response.json({ kind: "committed", txid: rows[0]?.txid ?? null });
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  } finally {
    db.release();
  }
});

async function applyBatch(db: import("pg").PoolClient, boardId: string, ops: unknown[], author: string | null) {
  await db.query(
    `with input as (
       select * from jsonb_to_recordset($2::jsonb) as t(id uuid, op text, type text, data jsonb, z float8)
     ),
     up as (
       insert into elements (id, board_id, type, data, z, created_by)
       select id, $1, type, data, z, $3 from input where op = 'upsert'
       on conflict (id) do update
         set type = excluded.type, data = excluded.data, z = excluded.z, updated_at = now()
         where elements.board_id = $1
       returning id
     ),
     del as (
       delete from elements where board_id = $1 and id in (select id from input where op = 'delete')
       returning id, type
     ),
     -- Chat blocks in windows being saved now (dragged in from the board or from another window) keep their messages.
     kept_threads as (
       select nb->>'id' as id
       from input i
       cross join jsonb_array_elements(case when jsonb_typeof(i.data->'blocks') = 'array' then i.data->'blocks' else '[]'::jsonb end) nb
       where i.op = 'upsert' and i.type = 'window'
     ),
     -- Chat blocks a window no longer has (or the whole window was deleted). Data-modifying CTEs
     -- all see the table as it was, so this reads the window before this change.
     gone_blocks as (
       select b->>'id' as id
       from elements e
       join input i on i.id = e.id
       cross join jsonb_array_elements(coalesce(e.data->'blocks', '[]'::jsonb)) b
       where e.board_id = $1 and e.type = 'window' and b->>'kind' = 'chat'
         and not exists (
           select 1 from jsonb_array_elements(coalesce(i.data->'blocks', '[]'::jsonb)) nb where nb->>'id' = b->>'id'
         )
         -- Moved out onto the board as a chat box with the same id: the conversation goes with it.
         and not exists (select 1 from input i2 where i2.op = 'upsert' and i2.id::text = b->>'id')
         -- Or moved into another window.
         and b->>'id' not in (select id from kept_threads)
     ),
     -- A deleted chat box or chat block takes its conversation with it.
     chat_gone as (
       delete from messages
       where board_id = $1
         and (
           thread in (select id from del where type in ('chatbox', 'game') and id::text not in (select id from kept_threads))
           or thread::text in (select id from gone_blocks)
         )
     ),
     ev as (
       insert into element_events (board_id, element_id, op, type, data, z, author)
       select $1, id, op, type, data, z, $3 from input
       returning pg_current_xact_id()::text as txid
     )
     select txid from ev limit 1`,
    [boardId, JSON.stringify(ops), author],
  );
}
