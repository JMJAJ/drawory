import { randomBytes } from "node:crypto";
import { handler } from "@/lib/server/http";
import { redirectUri, SCOPES, spotifyApp } from "@/lib/server/spotify";

/** Sends you to Spotify to allow "see what I'm playing", then back to the room you were in. */
export const GET = handler(async (req) => {
  const url = new URL(req.url);
  const raw = url.searchParams.get("back") ?? "/";
  // Only paths on this site.
  const back = /^\/[\w\-/]*$/.test(raw) ? raw : "/";
  const app = spotifyApp();
  if (!app) return Response.redirect(new URL(`${back}#spotify-error=setup`, req.url), 303);
  const state = randomBytes(16).toString("base64url");
  const auth = new URL("https://accounts.spotify.com/authorize");
  auth.search = new URLSearchParams({
    client_id: app.id,
    response_type: "code",
    redirect_uri: redirectUri(req),
    scope: SCOPES,
    state,
  }).toString();
  const res = new Response(null, { status: 303, headers: { Location: auth.toString() } });
  const secure = url.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  res.headers.append(
    "Set-Cookie",
    `drawory_spotify=${encodeURIComponent(`${state}|${back}`)}; Path=/api/spotify; HttpOnly; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}`,
  );
  return res;
});
