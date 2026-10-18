import type { ElementData, ElementRow } from "@/lib/types";
import { normalizePoints } from "./elements";

/** Mirror pen: 2 = left/right, 4 = both axes, 8 = kaleidoscope. 0 = off. */
export type MirrorMode = 0 | 2 | 4 | 8;

type T = (x: number, y: number) => [number, number];

/** The extra copies' transforms around a centre (the drawn stroke itself is not included). */
export function mirrorTransforms(mode: MirrorMode, cx: number, cy: number): T[] {
  const fx: T = (x, y) => [2 * cx - x, y];
  const fy: T = (x, y) => [x, 2 * cy - y];
  const rot = (k: number): T => (x, y) => {
    const a = (k * Math.PI) / 2;
    const dx = x - cx, dy = y - cy;
    return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
  };
  if (mode === 2) return [fx];
  if (mode === 4) return [fx, fy, (x, y) => fx(...fy(x, y))];
  if (mode === 8) {
    const out: T[] = [fx];
    for (let k = 1; k < 4; k++) {
      const r = rot(k);
      out.push(r, (x, y) => r(...fx(x, y)));
    }
    return out;
  }
  return [];
}

/** A copy of a stroke, rectangle or ellipse moved by a transform. */
export function transformData(row: Pick<ElementRow, "type" | "data">, t: T): ElementData {
  const d = row.data;
  if (row.type === "stroke") {
    const abs = (d.points ?? []).map(([x, y, p]) => {
      const [nx, ny] = t(d.x + x, d.y + y);
      return [nx, ny, p ?? 0.5];
    });
    return { ...d, ...normalizePoints(abs, d.size ?? 6) };
  }
  const corners = [
    t(d.x, d.y),
    t(d.x + (d.w ?? 0), d.y),
    t(d.x, d.y + (d.h ?? 0)),
    t(d.x + (d.w ?? 0), d.y + (d.h ?? 0)),
  ];
  const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { ...d, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
