import { requireBoard } from "@/lib/server/db";
import { boardIdFrom, handler, HttpError } from "@/lib/server/http";
import { LIVE_QUERY_NAMES } from "@/lib/server/queries";
import { sealBoardQuery } from "@/lib/server/realtime";
import type { LiveQueryName } from "@/lib/types";

type Ctx = { params: Promise<{ boardId: string }> };

/** Seals a live query for this board. Called on load and again before each expiry. */
export const POST = handler<Ctx>(async (req, { params }) => {
  const boardId = boardIdFrom((await params).boardId);
  const body = await req.json().catch(() => ({}));
  const name = body?.query as LiveQueryName;
  if (!LIVE_QUERY_NAMES.includes(name)) throw new HttpError(400, "Unknown live query");
  await requireBoard(boardId);
  return Response.json(await sealBoardQuery(boardId, name), {
    headers: { "Cache-Control": "no-store" },
  });
});
