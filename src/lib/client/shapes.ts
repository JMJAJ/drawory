// Turning a hand-drawn stroke into a clean shape ("hold to straighten").

export type Pt = number[]; // [x, y, pressure?]

export type Recognized =
  | { kind: "line"; a: [number, number]; b: [number, number] }
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "ellipse"; x: number; y: number; w: number; h: number }
  | { kind: "polygon"; pts: [number, number][] };

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function pathLength(pts: Pt[]) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  if (!len) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Ramer–Douglas–Peucker: the corners of a wobbly line. */
function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  let max = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > max) {
      max = d;
      at = i;
    }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  const left = simplify(pts.slice(0, at + 1), eps);
  return [...left.slice(0, -1), ...simplify(pts.slice(at), eps)];
}

/** Snaps a direction to the nearest 15°, keeping its length. */
export function snapAngle(a: [number, number], b: [number, number]): [number, number] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const step = Math.PI / 12;
  const ang = Math.round(Math.atan2(b[1] - a[1], b[0] - a[0]) / step) * step;
  return [a[0] + Math.cos(ang) * len, a[1] + Math.sin(ang) * len];
}

/** What shape a stroke was meant to be. Open strokes become straight lines. */
export function recognize(points: Pt[]): Recognized | null {
  if (points.length < 2) return null;
  const first = points[0], last = points[points.length - 1];
  const length = pathLength(points);
  if (length < 12) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of points) {
    x1 = Math.min(x1, x);
    y1 = Math.min(y1, y);
    x2 = Math.max(x2, x);
    y2 = Math.max(y2, y);
  }
  const w = x2 - x1, h = y2 - y1;
  const closed = dist(first, last) < Math.max(18, length * 0.18) && length > 2.4 * Math.max(w, h);
  if (!closed) return { kind: "line", a: [first[0], first[1]], b: [last[0], last[1]] };

  const diag = Math.hypot(w, h);
  const corners = simplify(points, diag * 0.09);
  // The end is back at the start: drop the duplicate corner.
  if (corners.length > 2 && dist(corners[0], corners[corners.length - 1]) < diag * 0.2) corners.pop();
  const n = corners.length;
  if (n === 3) return { kind: "polygon", pts: corners.map((p) => [p[0], p[1]] as [number, number]) };
  if (n === 4) {
    // Roughly level sides make a rectangle; a tilted one stays a four-sided shape.
    const level = corners.every((p, i) => {
      const q = corners[(i + 1) % 4];
      const ang = Math.abs(Math.atan2(q[1] - p[1], q[0] - p[0])) % (Math.PI / 2);
      return Math.min(ang, Math.PI / 2 - ang) < 0.3;
    });
    if (level) return { kind: "rect", x: x1, y: y1, w, h };
    return { kind: "polygon", pts: corners.map((p) => [p[0], p[1]] as [number, number]) };
  }
  return { kind: "ellipse", x: x1, y: y1, w, h };
}

/** Points along straight segments, so the pen's look (round ends, same width) stays. */
export function sampleSegments(corners: [number, number][], closed: boolean, step = 6): number[][] {
  const out: number[][] = [];
  const list = closed ? [...corners, corners[0]] : corners;
  for (let i = 0; i < list.length - 1; i++) {
    const [ax, ay] = list[i], [bx, by] = list[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, 0.5]);
  }
  const end = list[list.length - 1];
  out.push([end[0], end[1], 0.5]);
  return out;
}
