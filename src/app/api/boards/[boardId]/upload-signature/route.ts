import { createHash } from "node:crypto";
import { requireBoard } from "@/lib/server/db";
import { boardIdFrom, handler, HttpError } from "@/lib/server/http";

type Ctx = { params: Promise<{ boardId: string }> };

/** Reads CLOUDINARY_URL ("cloudinary://<key>:<secret>@<cloud>"), or the three separate variables. */
function cloudinary() {
  const url = process.env.CLOUDINARY_URL;
  if (url) {
    const m = url.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
    if (m) return { apiKey: m[1], apiSecret: m[2], cloudName: m[3] };
  }
  const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = process.env;
  return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null;
}

/**
 * A short-lived permission for the browser to upload one file straight to Cloudinary, into this
 * room's folder. The secret never leaves the server. 404 when Cloudinary isn't set up, so the
 * browser falls back to storing the file in Postgres.
 */
export const POST = handler<Ctx>(async (_req, { params }) => {
  const boardId = boardIdFrom((await params).boardId);
  const c = cloudinary();
  if (!c) throw new HttpError(404, "Cloudinary isn't set up");
  await requireBoard(boardId);
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `drawory/${boardId}`;
  // Cloudinary signs the alphabetically sorted parameters, joined with &, followed by the secret.
  const signature = createHash("sha1").update(`folder=${folder}&timestamp=${timestamp}${c.apiSecret}`).digest("hex");
  return Response.json(
    { cloudName: c.cloudName, apiKey: c.apiKey, timestamp, folder, signature },
    { headers: { "Cache-Control": "no-store" } },
  );
});
