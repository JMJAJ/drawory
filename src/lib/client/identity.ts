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

export function initials(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}
