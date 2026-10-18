// Who's on this device. Kept in localStorage; there are only ever two of you.

export interface Me {
  id: string;
  name: string;
  color: string;
}

export const PERSON_COLORS = [
  { name: "Rose", value: "#D13F58" },
  { name: "Blue", value: "#2F6BD0" },
  { name: "Teal", value: "#14877A" },
  { name: "Violet", value: "#7A4FD0" },
  { name: "Amber", value: "#B86E00" },
];

const KEY = "drawory:me";

export function loadMe(): Me | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const me = JSON.parse(raw);
    return me && typeof me.id === "string" && typeof me.name === "string" ? me : null;
  } catch {
    return null;
  }
}

export function saveMe(me: Me) {
  try {
    localStorage.setItem(KEY, JSON.stringify(me));
  } catch {
    // Private mode: identity lasts for this tab only.
  }
}

/** Black or white, whichever reads better on the given hex color. */
export function textOn(color: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? "#111115" : "#fff";
}

export function initials(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}
