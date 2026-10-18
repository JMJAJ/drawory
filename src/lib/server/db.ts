import "server-only";
import { Pool } from "pg";
import { HttpError } from "@/lib/server/http";

declare global {
  var __draworyPool: Pool | undefined;
}

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Run `neon env pull`.");
  const pool = new Pool({
    // Neon URLs say sslmode=require. verify-full keeps the same checks without pg's warning.
    connectionString: url.replace("sslmode=require", "sslmode=verify-full"),
    max: 10,
  });
  // An idle connection error (e.g. compute scaling to zero) must not crash the server.
  pool.on("error", (error) => console.error("pg pool error", error));
  return pool;
}

// Reuse one pool across hot reloads in development.
export const pool: Pool = globalThis.__draworyPool ?? (globalThis.__draworyPool = createPool());

/** Rooms are only made through POST /api/rooms; a code nobody created is a 404, never a new room. */
export async function requireBoard(boardId: string) {
  const { rowCount } = await pool.query("select 1 from boards where id = $1", [boardId]);
  if (!rowCount) throw new HttpError(404, "There's no room with that code");
}
