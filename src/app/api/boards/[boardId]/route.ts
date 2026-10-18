import { pool, requireBoard } from "@/lib/server/db";
import { boardIdFrom, cleanString, handler, HttpError } from "@/lib/server/http";

type Ctx = { params: Promise<{ boardId: string }> };

const PAGE_ID = /^[a-z0-9-]{1,24}$/;
const MAX_PAGES = 50;

async function readBoard(boardId: string) {
  const { rows } = await pool.query("select id, name, pages from boards where id = $1", [boardId]);
  return rows[0];
}

export const GET = handler<Ctx>(async (_req, { params }) => {
  const boardId = boardIdFrom((await params).boardId);
  await requireBoard(boardId);
  return Response.json(await readBoard(boardId));
});

/** Renames the room and/or replaces its list of pages. Everyone else refetches on the "board" signal. */
export const PATCH = handler<Ctx>(async (req, { params }) => {
  const boardId = boardIdFrom((await params).boardId);
  await requireBoard(boardId);
  const body = await req.json();
  const name = body.name === undefined ? null : cleanString(body.name, 80).trim() || "Untitled room";

  let pages: { id: string; name: string }[] | null = null;
  if (body.pages !== undefined) {
    if (!Array.isArray(body.pages) || body.pages.length === 0 || body.pages.length > MAX_PAGES) {
      throw new HttpError(400, `A room has 1 to ${MAX_PAGES} pages`);
    }
    pages = body.pages.map((p: { id?: unknown; name?: unknown }, i: number) => {
      const id = String(p?.id ?? "");
      if (!PAGE_ID.test(id)) throw new HttpError(400, "Bad page id");
      return { id, name: cleanString(p?.name, 40).trim() || `Page ${i + 1}` };
    });
    if (new Set(pages!.map((p) => p.id)).size !== pages!.length) throw new HttpError(400, "Duplicate page");
  }

  await pool.query("update boards set name = coalesce($2, name), pages = coalesce($3::jsonb, pages) where id = $1", [
    boardId,
    name,
    pages ? JSON.stringify(pages) : null,
  ]);
  await pool.query("insert into signals (board_id, kind, from_user) values ($1, 'board', $2)", [
    boardId,
    cleanString(body.from, 64, "someone"),
  ]);
  return Response.json(await readBoard(boardId));
});
