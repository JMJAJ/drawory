import "server-only";
import type { LiveQueryName } from "@/lib/types";

// The SQL behind each board query. Neon Realtime streams these; the snapshot route runs
// the same statements directly when the live connection can't be reached.
export const BOARD_QUERIES: Record<LiveQueryName, string> = {
  elements: `SELECT id, type, data, z, created_by, created_at, updated_at FROM elements WHERE board_id = $1`,
  presence: `SELECT user_id, name, color, cursor_x, cursor_y, view_x, view_y, view_w, view_h, zoom, tool, watching::text AS watching, page, activity, listening, updated_at
     FROM presence WHERE board_id = $1`,
  signals: `SELECT id, kind, from_user, payload, created_at FROM signals WHERE board_id = $1 ORDER BY id DESC LIMIT 30`,
  chat: `SELECT id, thread::text AS thread, user_id, name, color, body, reactions, created_at FROM messages WHERE board_id = $1 ORDER BY id DESC LIMIT 600`,
};

/** Cheap fingerprint of a board's elements, so polling can skip unchanged boards. */
export const ELEMENTS_VERSION = `SELECT count(*)::text || ':' || coalesce(max(updated_at)::text, '') AS v FROM elements WHERE board_id = $1`;

export const LIVE_QUERY_NAMES = Object.keys(BOARD_QUERIES) as LiveQueryName[];
