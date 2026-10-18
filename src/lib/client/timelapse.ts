"use client";

import { getStroke } from "perfect-freehand";
import type { ElementData, ElementRow, HistoryEvent } from "@/lib/types";
import { bounds, colorValue, unionBounds } from "./elements";

// A time-lapse video of a page: replays its history onto a canvas and records it.

const W = 1280;
const H = 720;
const FPS = 30;

function svgPath(stroke: number[][]) {
  if (stroke.length < 2) return "";
  const d: (string | number)[] = ["M", stroke[0][0], stroke[0][1], "Q"];
  for (let i = 0; i < stroke.length; i++) {
    const [x0, y0] = stroke[i];
    const [x1, y1] = stroke[(i + 1) % stroke.length];
    d.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  d.push("Z");
  return d.join(" ");
}

/** CSS colours (including var(--ink)) as something a canvas understands. */
function resolve(color: string | undefined) {
  const v = colorValue(color);
  const m = /^var\((--[\w-]+)\)$/.exec(v);
  return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || "#888" : v;
}

const images = new Map<string, HTMLImageElement | null>();
function image(src: string) {
  if (images.has(src)) return images.get(src) ?? null;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  images.set(src, null);
  img.onload = () => images.set(src, img);
  return null;
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

function draw(c: CanvasRenderingContext2D, row: Pick<ElementRow, "type" | "data">) {
  const d: ElementData = row.data;
  const b = bounds(row);
  c.save();
  c.globalAlpha = d.opacity ?? 1;
  if (d.angle) {
    c.translate(b.x + b.w / 2, b.y + b.h / 2);
    c.rotate((d.angle * Math.PI) / 180);
    c.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
  }
  const ink = resolve(d.color);
  switch (row.type) {
    case "stroke": {
      const outline = getStroke(d.points ?? [], { size: d.size ?? 6, thinning: d.highlight ? 0 : 0.55, smoothing: 0.5, streamline: 0.45 });
      c.translate(d.x, d.y);
      if (d.highlight) c.globalAlpha *= 0.38;
      c.fillStyle = ink;
      c.fill(new Path2D(svgPath(outline)));
      break;
    }
    case "rect":
    case "ellipse": {
      c.lineWidth = d.size ?? 3;
      c.strokeStyle = ink;
      c.beginPath();
      if (row.type === "rect") c.roundRect(b.x, b.y, b.w, b.h, 12);
      else c.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
      if (d.fill === "soft" || d.fill === "solid") {
        c.save();
        c.globalAlpha *= d.fill === "soft" ? 0.18 : 1;
        c.fillStyle = ink;
        c.fill();
        c.restore();
      }
      c.stroke();
      if (d.text) {
        c.fillStyle = d.fill === "solid" ? "#fff" : ink;
        c.font = "600 20px system-ui, sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(d.text, b.x + b.w / 2, b.y + b.h / 2, b.w * 0.8);
      }
      break;
    }
    case "arrow": {
      const [[x1, y1], [x2, y2]] = d.points ?? [[0, 0], [b.w, b.h]];
      const sw = d.size ?? 3;
      c.strokeStyle = ink;
      c.lineWidth = sw;
      c.lineCap = "round";
      c.translate(d.x, d.y);
      c.beginPath();
      c.moveTo(x1, y1);
      c.lineTo(x2, y2);
      const a = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.max(12, sw * 4);
      c.moveTo(x2 + head * Math.cos(a + Math.PI - 0.45), y2 + head * Math.sin(a + Math.PI - 0.45));
      c.lineTo(x2, y2);
      c.lineTo(x2 + head * Math.cos(a + Math.PI + 0.45), y2 + head * Math.sin(a + Math.PI + 0.45));
      c.stroke();
      break;
    }
    case "text": {
      c.fillStyle = ink;
      c.font = `${d.size ?? 28}px system-ui, sans-serif`;
      c.textBaseline = "top";
      (d.text ?? "").split("\n").forEach((line, i) => c.fillText(line, d.x, d.y + i * (d.size ?? 28) * 1.25));
      break;
    }
    case "image":
    case "sticker": {
      const img = d.src ? image(d.src) : null;
      if (img) c.drawImage(img, b.x, b.y, b.w, b.h);
      else {
        c.fillStyle = "rgba(128,128,128,0.25)";
        roundRect(c, b.x, b.y, b.w, b.h, 12);
        c.fill();
      }
      break;
    }
    default: {
      // Cards (notes, windows, chats…) as their outline and title.
      const sticky = row.type === "sticky";
      c.fillStyle = sticky ? "#FFE58F" : getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#fff";
      c.strokeStyle = "rgba(128,128,128,0.35)";
      roundRect(c, b.x, b.y, b.w, b.h, 16);
      c.fill();
      c.stroke();
      const label = d.text || d.title || d.name || "";
      if (label) {
        c.fillStyle = sticky ? "#262321" : resolve("ink");
        c.font = "600 18px system-ui, sans-serif";
        c.textBaseline = "top";
        c.fillText(label.slice(0, 60), b.x + 14, b.y + 14, b.w - 28);
      }
    }
  }
  c.restore();
}

/**
 * Records the page being built, from empty to now, as a WebM video (a few seconds long).
 * onProgress gets 0..1. Resolves with the video file.
 */
export async function recordTimelapse(events: HistoryEvent[], page: string, onProgress: (p: number) => void): Promise<Blob> {
  const onPage = (d: ElementData | null) => (d?.page ?? "main") === page;
  const steps = events.filter((e) => e.op === "delete" || onPage(e.data));
  // The finished page decides the framing.
  const final = new Map<string, Pick<ElementRow, "type" | "data">>();
  for (const e of steps) {
    if (e.op === "delete" || !e.data || !e.type) final.delete(e.element_id);
    else final.set(e.element_id, { type: e.type, data: e.data });
  }
  const box = unionBounds([...final.values()]) ?? unionBounds(steps.filter((e) => e.data && e.type).map((e) => ({ type: e.type!, data: e.data! })));
  if (!box) throw new Error("Nothing on this page yet");
  for (const r of final.values()) if ((r.type === "image" || r.type === "sticker") && r.data.src) image(r.data.src);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext("2d")!;
  const pad = 60;
  const scale = Math.min((W - pad * 2) / Math.max(box.w, 1), (H - pad * 2) / Math.max(box.h, 1), 2);
  const ox = W / 2 - (box.x + box.w / 2) * scale;
  const oy = H / 2 - (box.y + box.h / 2) * scale;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#f5f5f7";

  const stream = canvas.captureStream(FPS);
  const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "video/webm";
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<Blob>((resolve) => (rec.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }))));

  // 6 to 20 seconds, then a 2 second hold on the finished page.
  const seconds = Math.min(20, Math.max(6, steps.length / 25));
  const frames = Math.round(seconds * FPS);
  const hold = 2 * FPS;
  const state = new Map<string, Pick<ElementRow, "type" | "data">>();
  let applied = 0;
  rec.start(250);
  for (let f = 0; f <= frames + hold; f++) {
    const upTo = Math.min(steps.length, Math.round((Math.min(f, frames) / frames) * steps.length));
    for (; applied < upTo; applied++) {
      const e = steps[applied];
      if (e.op === "delete" || !e.data || !e.type || !onPage(e.data)) state.delete(e.element_id);
      else state.set(e.element_id, { type: e.type, data: e.data });
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);
    c.setTransform(scale, 0, 0, scale, ox, oy);
    for (const r of state.values()) {
      if (r.type === "place" || r.type === "game") continue;
      draw(c, r);
    }
    onProgress(f / (frames + hold));
    await new Promise((r) => setTimeout(r, 1000 / FPS));
  }
  rec.stop();
  return done;
}
