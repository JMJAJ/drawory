import { randomInt } from "node:crypto";
import { pool } from "@/lib/server/db";
import { cleanString, handler, HttpError } from "@/lib/server/http";

// Easy to read aloud and type: no 0/o, 1/l/i.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 6;

function newCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** Creates a room. Its code is the board id, and anyone who has it can join. */
export const POST = handler<unknown>(async (req) => {
  const body = await req.json().catch(() => ({}));
  const name = cleanString(body.name, 80).trim() || "Untitled room";
  const by = cleanString(body.by, 64) || null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = newCode();
    const { rows } = await pool.query(
      "insert into boards (id, name, created_by) values ($1, $2, $3) on conflict (id) do nothing returning id, name",
      [code, name, by],
    );
    if (rows[0]) return Response.json(rows[0], { status: 201 });
  }
  throw new HttpError(503, "Couldn't make a room code, try again");
});
