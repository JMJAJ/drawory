// Shared-passcode auth. Works in both the proxy and route handlers (Web Crypto only).

export const SESSION_COOKIE = "drawory_session";

export function authEnabled() {
  return Boolean(process.env.APP_PASSCODE);
}

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The cookie value for the current passcode. Changing APP_PASSCODE signs everyone out. */
export async function sessionToken() {
  const secret = process.env.AUTH_SECRET || process.env.NEON_REALTIME_SECRET || "drawory-dev";
  return hmacHex(secret, `drawory:${process.env.APP_PASSCODE ?? ""}`);
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isValidSession(cookieValue: string | undefined) {
  if (!authEnabled()) return true;
  if (!cookieValue) return false;
  return timingSafeEqual(cookieValue, await sessionToken());
}

export async function isValidPasscode(input: string) {
  const expected = process.env.APP_PASSCODE ?? "";
  return timingSafeEqual(await hmacHex("p", input), await hmacHex("p", expected));
}
