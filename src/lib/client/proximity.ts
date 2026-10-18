// Proximity audio: sounds on the board get quieter the further your view is from them.

export interface Listener {
  /** Where I am on the board: the middle of my screen, in board units. */
  x: number;
  y: number;
}

/** Full volume this close (board units, measured to the nearest edge of the thing playing). */
export const FULL_WITHIN = 300;
/** Silent from this far away. */
export const SILENT_AT = 2200;

/** 1 when close, easing smoothly down to 0 far away. */
export function proximityFactor(box: { x: number; y: number; w: number; h: number }, at: Listener) {
  const dx = Math.max(box.x - at.x, 0, at.x - (box.x + box.w));
  const dy = Math.max(box.y - at.y, 0, at.y - (box.y + box.h));
  const d = Math.hypot(dx, dy);
  if (d <= FULL_WITHIN) return 1;
  if (d >= SILENT_AT) return 0;
  const t = (d - FULL_WITHIN) / (SILENT_AT - FULL_WITHIN);
  return 1 - t * t * (3 - 2 * t); // smoothstep
}

/**
 * Applies a proximity factor on top of whatever volume the person chose in the player itself.
 * If they move the player's own volume slider, that becomes the new full volume.
 */
export function volumeKeeper(get: () => number, set: (v: number) => void) {
  let lastSet: number | null = null;
  let lastFactor = 1;
  let base = 1;
  return (factor: number) => {
    let current: number;
    try {
      current = get();
    } catch {
      return; // player not ready yet
    }
    if (lastSet !== null && Math.abs(current - lastSet) > 0.02 && lastFactor > 0.05) base = Math.min(1, current / lastFactor);
    const target = Math.max(0, Math.min(1, base * factor));
    try {
      set(target);
    } catch {
      return;
    }
    lastSet = target;
    lastFactor = factor;
  };
}
