import "server-only";
import { connection, type NextRequest } from "next/server";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth";

export const BOARD_ID = /^[a-z0-9-]{1,40}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Second line of defense behind the proxy: every API route checks the session itself. */
export async function requireSession(req: NextRequest) {
  if (!(await isValidSession(req.cookies.get(SESSION_COOKIE)?.value))) {
    throw new HttpError(401, "Sign in first");
  }
}

/** View-only links use codes with this prefix. They can read a room but never change it. */
export const VIEW_PREFIX = "view-";

export function boardIdFrom(value: string) {
  if (value.startsWith(VIEW_PREFIX)) throw new HttpError(403, "This is a view-only link");
  if (!BOARD_ID.test(value)) throw new HttpError(400, "Invalid board id");
  return value;
}

export function cleanString(value: unknown, max: number, fallback = "") {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

export function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Wraps a route handler so thrown HttpErrors become JSON responses. */
export function handler<Ctx>(fn: (req: NextRequest, ctx: Ctx) => Promise<Response>) {
  return async (req: NextRequest, ctx: Ctx) => {
    // API routes always run per request; never prerender them.
    await connection();
    try {
      await requireSession(req);
      return await fn(req, ctx);
    } catch (error) {
      if (error instanceof HttpError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      console.error(error);
      return Response.json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}
