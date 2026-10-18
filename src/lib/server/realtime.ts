import "server-only";
import { createRealtime, rawSql } from "@neon/realtime/server";
import { BOARD_QUERIES } from "@/lib/server/queries";
import type { ChatRow, ElementRow, LiveQueryName, PresenceRow, SignalRow } from "@/lib/types";

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

export async function sealBoardQuery(boardId: string, name: LiveQueryName) {
  const realtime = getRealtime();
  switch (name) {
    case "elements":
      return realtime.seal({ query: rawSql<ElementRow>(BOARD_QUERIES.elements, [boardId]) });
    case "presence":
      return realtime.seal({ query: rawSql<PresenceRow>(BOARD_QUERIES.presence, [boardId]) });
    case "signals":
      return realtime.seal({ query: rawSql<SignalRow>(BOARD_QUERIES.signals, [boardId]) });
    case "chat":
      return realtime.seal({ query: rawSql<ChatRow>(BOARD_QUERIES.chat, [boardId]) });
  }
}
