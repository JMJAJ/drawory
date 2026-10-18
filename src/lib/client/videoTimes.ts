"use client";

// Where each Watch together video is right now on this screen (seconds), for notes pinned to a moment.

const getters = new Map<string, () => number | null>();

export function registerVideo(elementId: string, getTime: () => number | null) {
  getters.set(elementId, getTime);
  return () => {
    if (getters.get(elementId) === getTime) getters.delete(elementId);
  };
}

export function videoTime(elementId: string) {
  try {
    return getters.get(elementId)?.() ?? null;
  } catch {
    return null;
  }
}

export function formatVideoTime(t: number) {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
