/** The reactions you can put on a chat message. */
export const REACTIONS = ["❤️", "😂", "👍", "😮", "😢", "🔥"];

/** Does this message mention this person (by their first name or full name)? */
export function mentions(body: string, name: string) {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  const first = n.split(/\s+/)[0];
  const words = body.toLowerCase().match(/@[\p{L}\p{N}_.-]+/gu) ?? [];
  return words.some((w) => w === `@${first}` || w === `@${n.replace(/\s+/g, "")}` || w === "@everyone");
}
