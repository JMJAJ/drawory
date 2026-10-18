import { pool, readableBoard } from "@/lib/server/db";
import { handler, HttpError } from "@/lib/server/http";
import { BOARD_QUERIES, ELEMENTS_VERSION, LIVE_QUERY_NAMES } from "@/lib/server/queries";
import type { LiveQueryName } from "@/lib/types";

type Ctx = { params: Promise<{ boardId: string }> };

/**
 * The current rows of one board query, for when the live connection is down or blocked
 * (e.g. a site address Realtime doesn't allow yet). The board polls this until live returns.
 * Elements answer `unchanged` when `v` matches, so idle boards cost almost nothing.
 */
export const GET = handler<Ctx>(async (req, { params }) => {
  const boardId = await readableBoard((await params).boardId);
  const name = req.nextUrl.searchParams.get("q") as LiveQueryName;
  if (!LIVE_QUERY_NAMES.includes(name)) throw new HttpError(400, "Unknown query");
  const headers = { "Cache-Control": "no-store" };
  const now = Date.now();

  let v: string | undefined;
  if (name === "elements") {
    v = (await pool.query(ELEMENTS_VERSION, [boardId])).rows[0].v as string;
    if (v === req.nextUrl.searchParams.get("v")) return Response.json({ unchanged: true, v, now }, { headers });
  }
  const { rows } = await pool.query(BOARD_QUERIES[name], [boardId]);
  return Response.json({ rows, v, now }, { headers });
});
