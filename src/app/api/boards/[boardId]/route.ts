import { pool, readableBoard, requireBoard } from "@/lib/server/db";
import { boardIdFrom, cleanString, handler, HttpError } from "@/lib/server/http";

type Ctx = { params: Promise<{ boardId: string }> };

const PAGE_ID = /^[a-z0-9-]{1,24}$/;
const MAX_PAGES = 50;

async function readBoard(boardId: string) {
  const { rows } = await pool.query("select id, name, pages, created_by, settings, view_code, emojis, focus from boards where id = $1", [boardId]);
  return rows[0];
}

export const GET = handler<Ctx>(async (_req, { params }) => {
  const code = (await params).boardId;
  const boardId = await readableBoard(code);
  const b = await readBoard(boardId);
  // Someone with a view-only link never learns the room's real code.
  if (code !== boardId) return Response.json({ id: code, name: b.name, pages: b.pages, settings: b.settings, emojis: b.emojis, focus: b.focus, viewOnly: true });
  return Response.json(b);
});

/** Renames the room and/or replaces its list of pages. Everyone else refetches on the "board" signal. */
export const PATCH = handler<Ctx>(async (req, { params }) => {
  const boardId = boardIdFrom((await params).boardId);
  await requireBoard(boardId);
  const body = await req.json();
  const name = body.name === undefined ? null : cleanString(body.name, 80).trim() || "Untitled room";
  // Room settings belong to whoever made the room.
  let settings: Record<string, boolean> | null = null;
  if (body.settings !== undefined) {
    const { rows } = await pool.query("select created_by from boards where id = $1", [boardId]);
    if (!rows[0]?.created_by || rows[0].created_by !== cleanString(body.from, 64)) throw new HttpError(403, "Only the person who made the room can change that");
    settings = { creatorOnlyClear: body.settings?.creatorOnlyClear === true };
  }

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

  await pool.query(
    "update boards set name = coalesce($2, name), pages = coalesce($3::jsonb, pages), settings = coalesce($4::jsonb, settings) where id = $1",
    [boardId, name, pages ? JSON.stringify(pages) : null, settings ? JSON.stringify(settings) : null],
  );
  // The focus timer: anyone can change it. focusIf: only if it still ends when the sender thought
  // (so two people noticing "time's up" at once move it on just once).
  if (body.focus !== undefined) {
    const f = body.focus;
    const ok =
      f === null ||
      (f && typeof f === "object" && (f.phase === "focus" || f.phase === "break") && Number.isInteger(f.rounds) && f.rounds >= 0 &&
        (f.endsAt === null || Number.isFinite(f.endsAt)) && (f.pausedLeft === null || Number.isFinite(f.pausedLeft)));
    if (!ok) throw new HttpError(400, "Bad timer");
    const clean = f === null ? null : { phase: f.phase, endsAt: f.endsAt, pausedLeft: f.pausedLeft, rounds: Math.min(f.rounds, 999) };
    const ifEnds = Number.isFinite(body.focusIf) ? String(body.focusIf) : null;
    await pool.query(
      "update boards set focus = $2::jsonb where id = $1 and ($3::text is null or focus->>'endsAt' = $3)",
      [boardId, clean === null ? null : JSON.stringify(clean), ifEnds],
    );
  }
  await pool.query("insert into signals (board_id, kind, from_user) values ($1, 'board', $2)", [
    boardId,
    cleanString(body.from, 64, "someone"),
  ]);
  return Response.json(await readBoard(boardId));
});
