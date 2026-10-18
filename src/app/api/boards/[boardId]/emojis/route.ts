import { EMOJIS } from "@/lib/emojis";
import { pool, requireBoard } from "@/lib/server/db";
import { boardIdFrom, cleanString, handler, HttpError } from "@/lib/server/http";

type Ctx = { params: Promise<{ boardId: string }> };

const NAME = /^[A-Za-z0-9_]{2,32}$/;
const MAX = 300;

/** Adds an emoji made from a drawing on the board. Everyone in the room can use it in chat. */
export const POST = handler<Ctx>(async (req, { params }) => {
  const boardId = boardIdFrom((await params).boardId);
  await requireBoard(boardId);
  const b = await req.json();
  const name = cleanString(b.name, 40).trim();
  if (!NAME.test(name)) throw new HttpError(400, "Use 2 to 32 letters, numbers or _");
  const url = cleanString(b.url, 500);
  if (!/^(https:\/\/res\.cloudinary\.com\/|\/api\/media\/)/.test(url)) throw new HttpError(400, "That picture didn't upload here");
  if (EMOJIS.some((e) => e.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, "There's already an emoji called that");
  const { rows } = await pool.query(
    `update boards set emojis = emojis || jsonb_build_array(jsonb_build_object('name', $2::text, 'url', $3::text, 'by', $4::text))
      where id = $1 and jsonb_array_length(emojis) < $5
        and not exists (select 1 from jsonb_array_elements(emojis) e where lower(e->>'name') = lower($2))
      returning emojis`,
    [boardId, name, url, cleanString(b.from, 40), MAX],
  );
  if (!rows[0]) throw new HttpError(409, "There's already an emoji called that, or the room is full of them");
  await pool.query("insert into signals (board_id, kind, from_user) values ($1, 'board', $2)", [boardId, cleanString(b.from, 64, "someone")]);
  return Response.json({ emojis: rows[0].emojis }, { status: 201 });
});
