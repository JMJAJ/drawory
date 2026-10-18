"use client";

// The private key from linking Spotify lives only in this browser.
const KEY = "drawory:spotify";
const SHARE = "drawory:spotify-share";

export function spotifyKey() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function sharingSpotify() {
  try {
    return localStorage.getItem(SHARE) !== "off";
  } catch {
    return true;
  }
}

export function setSharingSpotify(on: boolean) {
  try {
    localStorage.setItem(SHARE, on ? "on" : "off");
  } catch {}
}

export function forgetSpotify() {
  const key = spotifyKey();
  try {
    localStorage.removeItem(KEY);
  } catch {}
  if (key) void fetch("/api/spotify/disconnect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
}

/** Coming back from Spotify: keep the key from the address and tidy it away. Returns what happened. */
export function takeSpotifyReturn(): "linked" | "setup" | "denied" | "failed" | null {
  const hash = window.location.hash;
  const linked = /#spotify=([\w-]{20,64})/.exec(hash);
  const failed = /#spotify-error=(\w+)/.exec(hash);
  if (!linked && !failed) return null;
  history.replaceState(null, "", window.location.pathname + window.location.search);
  if (linked) {
    try {
      localStorage.setItem(KEY, linked[1]);
      localStorage.setItem(SHARE, "on");
    } catch {}
    return "linked";
  }
  const why = failed![1];
  return why === "setup" ? "setup" : why === "denied" ? "denied" : "failed";
}

export function connectSpotify() {
  window.location.href = `/api/spotify/login?back=${encodeURIComponent(window.location.pathname)}`;
}

/** Where a song is now, counting the time since it was measured. */
export function liveProgress(l: { progress: number; duration: number; at: number }, now: number) {
  return Math.min(l.duration, l.progress + Math.max(0, now - l.at));
}
