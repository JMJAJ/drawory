import type { ElementData, ElementRow, ElementType } from "@/lib/types";

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.08;
export const MAX_ZOOM = 8;
export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Stroke colors. "ink" follows the theme so it reads in day and night. */
export const STROKE_COLORS = [
  { id: "ink", label: "Ink", value: "var(--ink)" },
  { id: "rose", label: "Rose", value: "var(--accent)" },
  { id: "blue", label: "Blue", value: "var(--partner)" },
  { id: "teal", label: "Teal", value: "#14A38F" },
  { id: "amber", label: "Amber", value: "#E39A1C" },
  { id: "violet", label: "Violet", value: "#8E63DA" },
];
export const STROKE_SIZES = [
  { id: 1, label: "Thin", px: 3 },
  { id: 2, label: "Medium", px: 6 },
  { id: 3, label: "Bold", px: 12 },
];

export function colorValue(id: string | undefined) {
  return STROKE_COLORS.find((c) => c.id === id)?.value ?? id ?? "var(--ink)";
}

/** Types whose box can be dragged bigger or smaller. */
export const RESIZABLE: Partial<Record<ElementType, "free" | "aspect" | "width" | "font">> = {
  rect: "free",
  ellipse: "free",
  place: "free",
  image: "aspect",
  sticker: "aspect",
  video: "aspect",
  youtube: "width",
  embed: "free",
  note: "width",
  link: "width",
  text: "font",
  capsule: "width",
  audio: "width",
  chatbox: "free",
  sticky: "free",
  window: "free",
};

/** Heights of auto-sized elements as they last rendered here, so selection and hit tests match. */
export const measuredHeights = new Map<string, number>();

/** Types the style bar can recolor. */
export const STYLABLE: ElementType[] = ["stroke", "rect", "ellipse", "arrow", "text"];

export function bounds(el: Pick<ElementRow, "type" | "data">) {
  const d = el.data;
  const fallback: Record<string, [number, number]> = {
    text: [Math.max(40, (d.text?.length ?? 4) * (d.size ?? 28) * 0.55), (d.size ?? 28) * 1.4],
    note: [d.w ?? 260, 60 + (d.items?.length ?? 0) * 34],
    audio: [d.w ?? 320, 64],
    capsule: [d.w ?? 300, 190],
    link: [d.w ?? 280, d.image ? 240 : 130],
    sticky: [d.w ?? 200, d.h ?? 200],
    window: [d.w ?? 640, d.h ?? measuredHeights.get((el as { id?: string }).id ?? "") ?? 120 + (d.blocks?.length ?? 0) * 110],
    // 16:9 video plus 10 px padding each side and the title row.
    youtube: [d.w ?? 480, ((d.w ?? 480) - 20) * (9 / 16) + 82],
  };
  const [fw, fh] = fallback[el.type] ?? [d.w ?? 100, d.h ?? 100];
  const h = el.type === "youtube" || el.type === "window" ? fh : d.h ?? fh;
  return { x: d.x, y: d.y, w: d.w && el.type !== "text" ? d.w : fw, h };
}

type Box = { x: number; y: number; w: number; h: number };
export type SnapGuide = { axis: "x" | "y"; at: number; from: number; to: number };

/** Gap left between items docked side by side. */
export const DOCK_GAP = 24;

/**
 * Nudges a box being dragged so its edges or centre line up with nearby items, or so it docks
 * next to one with a small gap. Returns how far to shift it and the guide lines to draw.
 */
export function snapBox(box: Box, others: readonly Box[], tolerance: number) {
  let best = { x: { d: tolerance + 1, shift: 0, at: 0, o: null as Box | null }, y: { d: tolerance + 1, shift: 0, at: 0, o: null as Box | null } };
  for (const o of others) {
    // Only things close enough to matter.
    if (o.x > box.x + box.w + 600 || o.x + o.w < box.x - 600 || o.y > box.y + box.h + 600 || o.y + o.h < box.y - 600) continue;
    const xs: [number, number][] = [
      [box.x, o.x], [box.x, o.x + o.w], [box.x + box.w, o.x + o.w], [box.x + box.w, o.x],
      [box.x + box.w / 2, o.x + o.w / 2],
      [box.x, o.x + o.w + DOCK_GAP], [box.x + box.w, o.x - DOCK_GAP],
    ];
    const ys: [number, number][] = [
      [box.y, o.y], [box.y, o.y + o.h], [box.y + box.h, o.y + o.h], [box.y + box.h, o.y],
      [box.y + box.h / 2, o.y + o.h / 2],
      [box.y, o.y + o.h + DOCK_GAP], [box.y + box.h, o.y - DOCK_GAP],
    ];
    for (const [mine, theirs] of xs) {
      const d = Math.abs(theirs - mine);
      if (d < best.x.d) best = { ...best, x: { d, shift: theirs - mine, at: theirs, o } };
    }
    for (const [mine, theirs] of ys) {
      const d = Math.abs(theirs - mine);
      if (d < best.y.d) best = { ...best, y: { d, shift: theirs - mine, at: theirs, o } };
    }
  }
  const sx = best.x.d <= tolerance ? best.x.shift : 0;
  const sy = best.y.d <= tolerance ? best.y.shift : 0;
  const guides: SnapGuide[] = [];
  if (best.x.d <= tolerance && best.x.o) {
    const o = best.x.o;
    guides.push({ axis: "x", at: best.x.at, from: Math.min(o.y, box.y + sy), to: Math.max(o.y + o.h, box.y + sy + box.h) });
  }
  if (best.y.d <= tolerance && best.y.o) {
    const o = best.y.o;
    guides.push({ axis: "y", at: best.y.at, from: Math.min(o.x, box.x + sx), to: Math.max(o.x + o.w, box.x + sx + box.w) });
  }
  return { sx, sy, guides };
}

export function contains(outer: ReturnType<typeof bounds>, inner: ReturnType<typeof bounds>) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

export function unionBounds(rows: readonly Pick<ElementRow, "type" | "data">[]) {
  if (rows.length === 0) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rows) {
    const b = bounds(r);
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w);
    y2 = Math.max(y2, b.y + b.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Camera that shows a world rectangle centred in a viewport. */
export function cameraFor(rect: { x: number; y: number; w: number; h: number }, vw: number, vh: number, pad = 120) {
  const zoom = clampZoom(Math.min((vw - pad) / Math.max(rect.w, 1), (vh - pad * 1.6) / Math.max(rect.h, 1), 1.5));
  return { zoom, x: vw / 2 - (rect.x + rect.w / 2) * zoom, y: vh / 2 - (rect.y + rect.h / 2) * zoom };
}

/** Normalises freehand points into a box: element x/y is the top-left, points are relative. */
export function normalizePoints(points: number[][], pad: number) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const x = minX - pad;
  const y = minY - pad;
  return {
    x,
    y,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
    points: points.map(([px, py, p]) => [Math.round((px - x) * 10) / 10, Math.round((py - y) * 10) / 10, p ?? 0.5]),
  };
}

export function newId() {
  return crypto.randomUUID();
}

export function makeRow(type: ElementType, data: ElementData, z: number, createdBy: string): ElementRow {
  const now = new Date();
  return { id: newId(), type, data, z, created_by: createdBy, created_at: now, updated_at: now };
}

/** Fonts for text. Each maps to a CSS variable set up by next/font in the root layout. */
export const FONTS = [
  { id: "clean", label: "Clean", css: "var(--font-geist-sans), system-ui, sans-serif" },
  { id: "elegant", label: "Elegant", css: "var(--font-elegant), Georgia, serif" },
  { id: "hand", label: "Handwritten", css: "var(--font-hand), cursive" },
  { id: "marker", label: "Marker", css: "var(--font-marker), cursive" },
  { id: "mono", label: "Mono", css: "var(--font-geist-mono), ui-monospace, monospace" },
] as const;

export function fontValue(id: string | undefined) {
  return (FONTS.find((f) => f.id === id) ?? FONTS[0]).css;
}
