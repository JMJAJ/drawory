import "server-only";
import { randomBytes } from "node:crypto";
import { pool } from "@/lib/server/db";
import { HttpError } from "@/lib/server/http";

// "Now listening" from Spotify. Reading what's playing works with free accounts too.
// Needs a Spotify app (developer.spotify.com): SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET, with
// <site>/api/spotify/callback added as a redirect URI.

export const SCOPES = "user-read-currently-playing user-read-playback-state";

export function spotifyApp() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}

/** The callback address for this site (Spotify needs it to match exactly). */
export function redirectUri(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}/api/spotify/callback`;
}

declare global {
  var __draworySpotifyTable: Promise<unknown> | undefined;
}

// Created on first use too, so a deploy that skipped `npm run db:migrate` still works.
export function ensureSpotifyTable() {
  globalThis.__draworySpotifyTable ??= pool
    .query(
      `create table if not exists spotify_links (
         key text primary key,
         refresh_token text not null,
         access_token text,
         expires_at timestamptz,
         created_at timestamptz not null default now()
       )`,
    )
    .catch((e) => {
      globalThis.__draworySpotifyTable = undefined;
      throw e;
    });
  return globalThis.__draworySpotifyTable;
}

async function tokenRequest(body: Record<string, string>) {
  const app = spotifyApp();
  if (!app) throw new HttpError(503, "Spotify isn't set up on this site yet");
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${app.id}:${app.secret}`).toString("base64")}`,
    },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status === 400 ? 401 : 502, json.error_description || "Spotify said no");
  return json as { access_token: string; refresh_token?: string; expires_in: number };
}

/** Swaps the sign-in code for tokens and saves them. Returns the private key the browser keeps. */
export async function linkAccount(code: string, redirect: string) {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirect });
  if (!t.refresh_token) throw new HttpError(502, "Spotify didn't send a refresh token");
  await ensureSpotifyTable();
  const key = randomBytes(24).toString("base64url");
  await pool.query(
    "insert into spotify_links (key, refresh_token, access_token, expires_at) values ($1, $2, $3, now() + make_interval(secs => $4))",
    [key, t.refresh_token, t.access_token, t.expires_in - 60],
  );
  return key;
}

async function accessToken(key: string) {
  await ensureSpotifyTable();
  const { rows } = await pool.query("select refresh_token, access_token, expires_at > now() as fresh from spotify_links where key = $1", [key]);
  const link = rows[0];
  if (!link) throw new HttpError(404, "Not connected to Spotify");
  if (link.fresh && link.access_token) return link.access_token as string;
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: link.refresh_token });
  await pool.query(
    "update spotify_links set access_token = $2, expires_at = now() + make_interval(secs => $3), refresh_token = coalesce($4, refresh_token) where key = $1",
    [key, t.access_token, t.expires_in - 60, t.refresh_token ?? null],
  );
  return t.access_token;
}

export interface NowListening {
  title: string;
  artists: string;
  image: string | null;
  url: string | null;
  progress: number;
  duration: number;
  playing: boolean;
}

/** What this person is playing on Spotify right now, or null. */
export async function nowListening(key: string): Promise<NowListening | null> {
  const token = await accessToken(key);
  const res = await fetch("https://api.spotify.com/v1/me/player/currently-playing?additional_types=track,episode", {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 204) return null;
  if (res.status === 401) throw new HttpError(401, "Spotify sign-in expired");
  if (!res.ok) throw new HttpError(502, "Couldn't ask Spotify");
  const d = await res.json();
  const item = d?.item;
  if (!item) return null;
  const images: { url: string; width: number }[] = item.album?.images ?? item.images ?? item.show?.images ?? [];
  const small = [...images].sort((a, b) => a.width - b.width).find((i) => i.width >= 64) ?? images[0];
  return {
    title: String(item.name ?? "").slice(0, 120),
    artists: (item.artists?.map((a: { name: string }) => a.name).join(", ") ?? item.show?.name ?? "").slice(0, 120),
    image: small?.url ?? null,
    url: item.external_urls?.spotify ?? null,
    progress: Number(d.progress_ms) || 0,
    duration: Number(item.duration_ms) || 0,
    playing: d.is_playing === true,
  };
}

export async function unlink(key: string) {
  await ensureSpotifyTable();
  await pool.query("delete from spotify_links where key = $1", [key]);
}

/* ---------- Data Card for Spotify (works with free accounts) ---------- */
// People who authorized https://data-card-for-spotify.herokuapp.com get a public card of what
// they're playing. We read that card instead of needing our own Spotify app (which needs Premium).

const CARD = "https://data-card-for-spotify.herokuapp.com/api/card?user_id=";
export const CARD_ID = /^[a-z0-9]{10,40}$/;

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

declare global {
  var __draworyCardCache: Map<string, { at: number; value: Promise<NowListening | null> }> | undefined;
  var __draworyCoverCache: Map<string, string | null> | undefined;
}

/** A track's cover from Spotify's public oEmbed (the card only has tiny inline pictures). */
async function coverFor(url: string) {
  const covers = (globalThis.__draworyCoverCache ??= new Map());
  if (covers.has(url)) return covers.get(url)!;
  const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(6_000) }).catch(() => null);
  const thumb = res?.ok ? ((await res.json().catch(() => ({}))) as { thumbnail_url?: string }).thumbnail_url ?? null : null;
  if (covers.size > 500) covers.clear();
  covers.set(url, thumb);
  return thumb;
}

async function readCard(userId: string): Promise<NowListening | null> {
  const res = await fetch(CARD + userId, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res) throw new HttpError(502, "Couldn't reach the Data Card site");
  if (res.status === 404 || res.status === 400) throw new HttpError(404, "That Data Card link doesn't work");
  if (!res.ok) throw new HttpError(502, "The Data Card site didn't answer");
  const svg = await res.text();
  const start = svg.indexOf('class="now-playing-section"');
  if (start < 0) return null;
  const end = svg.indexOf('class="other-sections"', start);
  const part = svg.slice(start, end < 0 ? start + 20_000 : end);
  // Only while something is actually playing.
  if (!/Currently Listening To/i.test(part)) return null;
  const url = /href="(https:\/\/open\.spotify\.com\/(?:track|episode)\/\w+)"/.exec(part)?.[1] ?? null;
  const title = /class="track-title[^"]*">([^<]+)</.exec(part)?.[1];
  const subtitle = /class="track-subtitle-text">([^<]+)</.exec(part)?.[1] ?? "";
  if (!title) return null;
  return {
    title: decode(title).slice(0, 120),
    artists: decode(subtitle).split(" • ")[0].slice(0, 120),
    image: url ? await coverFor(url) : null,
    url,
    progress: 0,
    duration: 0,
    playing: true,
  };
}

/** What someone with a Data Card is playing. Cached a few seconds, so many viewers cost one fetch. */
export function nowFromCard(userId: string) {
  const cache = (globalThis.__draworyCardCache ??= new Map());
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < 8_000) return hit.value;
  const value = readCard(userId);
  value.catch(() => cache.delete(userId));
  if (cache.size > 200) cache.clear();
  cache.set(userId, { at: Date.now(), value });
  return value;
}
