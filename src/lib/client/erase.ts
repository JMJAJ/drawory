import type { ElementData, ElementRow } from "@/lib/types";
import { normalizePoints } from "./elements";

/**
 * What's left of a stroke after rubbing out everything within r of the eraser's path.
 * Returns the remaining pieces (each one becomes its own stroke); empty if nothing is left.
 */
export function eraseFromStroke(row: ElementRow, path: number[][], r: number): ElementData[] {
  const d = row.data;
  const abs = (d.points ?? []).map(([x, y, p]) => [d.x + x, d.y + y, p ?? 0.5]);
  const r2 = r * r;
  const gone = (p: number[]) => path.some(([ex, ey]) => (p[0] - ex) ** 2 + (p[1] - ey) ** 2 <= r2);
  const pieces: number[][][] = [];
  let run: number[][] = [];
  for (const p of abs) {
    if (gone(p)) {
      if (run.length) pieces.push(run);
      run = [];
    } else run.push(p);
  }
  if (run.length) pieces.push(run);
  return pieces.filter((pc) => pc.length >= 2).map((pc) => ({ ...d, ...normalizePoints(pc, d.size ?? 6) }));
}

/** Fills in the eraser's path so fast movements don't skip over thin strokes. */
export function densify(path: number[][], step: number) {
  if (path.length < 2) return path;
  const out: number[][] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

/** Is a point inside a polygon (lasso)? */
export function inPolygon(x: number, y: number, poly: number[][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}
