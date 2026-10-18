import { pool } from "@/lib/server/db";
import { boardIdFrom, cleanString, handler, HttpError, UUID } from "@/lib/server/http";
import type { ElementType } from "@/lib/types";

type Ctx = { params: Promise<{ boardId: string }> };

const TYPES: ElementType[] = [
  "stroke", "rect", "ellipse", "arrow", "text", "note", "image", "video",
  "audio", "youtube", "embed", "link", "capsule", "place", "sticker", "chatbox", "sticky",
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
    if (raw.op !== "upsert") throw new HttpError(400, "Bad op");
    const type = raw.type as ElementType;
    if (!TYPES.includes(type)) throw new HttpError(400, "Bad element type");
    if (!raw.data || typeof raw.data !== "object") throw new HttpError(400, "Missing data");
    if (JSON.stringify(raw.data).length > MAX_DATA) throw new HttpError(413, "Element too large");
    const z = typeof raw.z === "number" && Number.isFinite(raw.z) ? raw.z : 0;
    return { id, op: "upsert", type, data: raw.data, z };
  });

  const { rows } = await pool.query(
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
     -- A deleted chat box takes its conversation with it.
     chat_gone as (
       delete from messages where board_id = $1 and thread in (select id from del where type = 'chatbox')
     ),
     ev as (
       insert into element_events (board_id, element_id, op, type, data, z, author)
       select $1, id, op, type, data, z, $3 from input
       returning pg_current_xact_id()::text as txid
     )
     select txid from ev limit 1`,
    [boardId, JSON.stringify(ops), author],
  );
  return Response.json({ kind: "committed", txid: rows[0]?.txid ?? null });
});
