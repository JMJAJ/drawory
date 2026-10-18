import { handler } from "@/lib/server/http";
import { linkAccount, redirectUri } from "@/lib/server/spotify";

/** Spotify sends you back here. The browser gets a private key (in the address fragment, never sent to servers). */
export const GET = handler(async (req) => {
  const url = new URL(req.url);
  const [state, back = "/"] = decodeURIComponent(req.cookies.get("drawory_spotify")?.value ?? "").split("|");
  const go = (hash: string) => {
    const res = new Response(null, { status: 303, headers: { Location: new URL(`${back || "/"}#${hash}`, req.url).toString() } });
    res.headers.append("Set-Cookie", "drawory_spotify=; Path=/api/spotify; Max-Age=0");
    return res;
  };
  if (!state || url.searchParams.get("state") !== state) return go("spotify-error=expired");
  const code = url.searchParams.get("code");
  if (!code) return go(`spotify-error=${url.searchParams.get("error") === "access_denied" ? "denied" : "failed"}`);
  try {
    return go(`spotify=${await linkAccount(code, redirectUri(req))}`);
  } catch (e) {
    console.error(e);
    return go("spotify-error=failed");
  }
});
