// Rooms this device has opened, newest first, for the home screen. Kept in localStorage.

export interface RecentRoom {
  id: string;
  name: string;
  visitedAt: number;
}

const KEY = "drawory:rooms";
const MAX = 12;

export function loadRooms(): RecentRoom[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((r) => r && typeof r.id === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberRoom(id: string, name: string) {
  try {
    const rest = loadRooms().filter((r) => r.id !== id);
    localStorage.setItem(KEY, JSON.stringify([{ id, name, visitedAt: Date.now() }, ...rest].slice(0, MAX)));
  } catch {
    // Private mode: nothing to remember.
  }
}

export function forgetRoom(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(loadRooms().filter((r) => r.id !== id)));
  } catch {}
}

/** Accepts a code typed any way ("k7m 2qx", "K7M2QX") or a pasted invite link. */
export function parseRoomCode(input: string) {
  const text = input.trim();
  const fromLink = text.match(/\/b\/([a-z0-9-]{1,40})/i)?.[1];
  const code = (fromLink ?? text).toLowerCase().replace(/\s+/g, "");
  return /^[a-z0-9-]{1,40}$/.test(code) ? code : null;
}

/** Codes read more easily in capitals: "k7m2qx" shows as "K7M2QX". */
export function displayCode(id: string) {
  return id.toUpperCase();
}

export function inviteLink(id: string) {
  return `${window.location.origin}/b/${id}`;
}
