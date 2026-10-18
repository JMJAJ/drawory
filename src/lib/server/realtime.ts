import "server-only";
import { createRealtime, rawSql } from "@neon/realtime/server";
import type { ElementRow, LiveQueryName, PresenceRow, SignalRow } from "@/lib/types";

function dbName() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return new URL(url).pathname.replace(/^\//, "") || "neondb";
}

declare global {
  var __draworyRealtime: ReturnType<typeof createRealtime> | undefined;
}

function getRealtime() {
  if (!globalThis.__draworyRealtime) {
    const secret = process.env.NEON_REALTIME_SECRET;
    if (!secret) throw new Error("NEON_REALTIME_SECRET is not set. Run `neon env pull`.");
    globalThis.__draworyRealtime = createRealtime({
      secret,
      db: dbName(),
      debugMode: process.env.NODE_ENV === "development",
    });
  }
  return globalThis.__draworyRealtime;
}

// Live queries. Each is scoped to one board; the board id comes from the validated URL.

function elementsQuery(boardId: string) {
  return rawSql<ElementRow>(
    `SELECT id, type, data, z, created_by, created_at, updated_at FROM elements WHERE board_id = $1`,
    [boardId],
  );
}

function presenceQuery(boardId: string) {
  return rawSql<PresenceRow>(
    `SELECT user_id, name, color, cursor_x, cursor_y, view_x, view_y, view_w, view_h, zoom, tool, watching::text AS watching, updated_at
     FROM presence WHERE board_id = $1`,
    [boardId],
  );
}

function signalsQuery(boardId: string) {
  return rawSql<SignalRow>(
    `SELECT id, kind, from_user, payload, created_at FROM signals WHERE board_id = $1 ORDER BY id DESC LIMIT 30`,
    [boardId],
  );
}

export async function sealBoardQuery(boardId: string, name: LiveQueryName) {
  const realtime = getRealtime();
  switch (name) {
    case "elements":
      return realtime.seal({ query: elementsQuery(boardId) });
    case "presence":
      return realtime.seal({ query: presenceQuery(boardId) });
    case "signals":
      return realtime.seal({ query: signalsQuery(boardId) });
  }
}
