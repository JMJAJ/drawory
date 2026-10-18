import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { handler, HttpError } from "@/lib/server/http";

// Fetches a link preview (title, description, image). Private and local addresses are refused,
// so the server can't be used to reach machines on its own network.

function isPrivate(ip: string) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivate(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

async function assertPublic(url: URL) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new HttpError(400, "Only web links");
  const addresses = await lookup(url.hostname, { all: true }).catch(() => []);
  if (addresses.length === 0 || addresses.some((a) => isPrivate(a.address))) {
    throw new HttpError(400, "That address can't be previewed");
  }
}

function meta(html: string, keys: string[]) {
  for (const key of keys) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
      "i",
    );
    const m = html.match(re);
    if (m) return decode(m[1] ?? m[2] ?? "");
  }
  return "";
}

function decode(s: string) {
  return s
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

export const GET = handler<unknown>(async (req) => {
  let url: URL;
  try {
    url = new URL(req.nextUrl.searchParams.get("url") ?? "");
  } catch {
    throw new HttpError(400, "Not a link");
  }

  // YouTube and Vimeo pages often show a consent screen to servers; their oEmbed APIs give the real title.
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  const oembed =
    host === "youtube.com" || host === "youtu.be"
      ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url.toString())}`
      : host === "vimeo.com"
        ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url.toString())}`
        : null;
  if (oembed) {
    const meta = await fetch(oembed, { signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (meta?.title) {
      return Response.json({
        url: url.toString(),
        title: String(meta.title).slice(0, 200),
        description: meta.author_name ? `by ${String(meta.author_name).slice(0, 100)}` : "",
        image: typeof meta.thumbnail_url === "string" && meta.thumbnail_url.startsWith("https://") ? meta.thumbnail_url : "",
        site: host,
      });
    }
  }

  let res: Response | undefined;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DraworyBot/1.0)", Accept: "text/html" },
    });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) break;
    url = new URL(next, url);
  }
  const site = url.hostname.replace(/^www\./, "");
  if (!res || !res.ok || !(res.headers.get("content-type") ?? "").includes("html")) {
    return Response.json({ url: url.toString(), title: site, site });
  }

  // Read at most ~500 KB of HTML.
  const reader = res.body!.getReader();
  let html = "";
  const decoder = new TextDecoder();
  while (html.length < 500_000) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
    if (html.includes("</head>")) break;
  }
  reader.cancel().catch(() => {});

  const title = meta(html, ["og:title", "twitter:title"]) || decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "") || site;
  let image = meta(html, ["og:image", "twitter:image"]);
  if (image) {
    try {
      image = new URL(image, url).toString();
    } catch {
      image = "";
    }
  }
  return Response.json({
    url: url.toString(),
    title: title.slice(0, 200),
    description: meta(html, ["og:description", "description"]).slice(0, 300),
    image: image.startsWith("https://") ? image : "",
    site,
  });
});
