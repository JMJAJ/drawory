"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/icons";
import type { ElementData, ElementRow } from "@/lib/types";

type Crop = NonNullable<ElementData["crop"]>;
const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };
const MIN = 0.05;

const norm = (deg: number | undefined) => (((deg ?? 0) % 360) + 360) % 360;

/** A photo shown cropped and turned. Fills its parent, which has the final shape. */
export function PhotoFrame({ src, alt, crop, rotate }: { src?: string; alt: string; crop?: Crop; rotate?: number }) {
  const r = norm(rotate);
  const c = crop ?? FULL;
  const sideways = r === 90 || r === 270;
  return (
    <div className="photo-frame">
      <div
        className="photo-turn"
        style={{
          width: sideways ? "var(--frame-h)" : "100%",
          height: sideways ? "var(--frame-w)" : "100%",
          transform: `translate(-50%, -50%) rotate(${r}deg)`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{ width: `${100 / c.w}%`, height: `${100 / c.h}%`, left: `${(-c.x / c.w) * 100}%`, top: `${(-c.y / c.h) * 100}%` }}
        />
      </div>
    </div>
  );
}

/** Crop and rotate a photo on the board. Keeps its width; the height follows the new shape. */
export function PhotoEditor({ row, onApply, onClose }: { row: ElementRow; onApply: (data: Partial<ElementData>) => void; onClose: () => void }) {
  const d = row.data;
  const [rotate, setRotate] = useState(norm(d.rotate));
  const [crop, setCrop] = useState<Crop>(d.crop ?? FULL);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: string; sx: number; sy: number; start: Crop } | null>(null);

  // Show the whole photo, unturned, as big as fits.
  const maxW = Math.min(640, (typeof window !== "undefined" ? window.innerWidth : 800) - 64);
  const maxH = Math.min(460, (typeof window !== "undefined" ? window.innerHeight : 700) - 280);
  const scale = natural ? Math.min(maxW / natural.w, maxH / natural.h) : 1;
  const dw = natural ? natural.w * scale : maxW, dh = natural ? natural.h * scale : maxH;

  function down(e: React.PointerEvent, mode: string) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: crop };
  }
  function move(e: React.PointerEvent) {
    const g = drag.current;
    if (!g) return;
    const dx = (e.clientX - g.sx) / dw, dy = (e.clientY - g.sy) / dh;
    let { x, y, w, h } = g.start;
    if (g.mode === "move") {
      x = Math.min(1 - w, Math.max(0, x + dx));
      y = Math.min(1 - h, Math.max(0, y + dy));
    } else {
      if (g.mode.includes("l")) {
        const nx = Math.min(x + w - MIN, Math.max(0, x + dx));
        w += x - nx;
        x = nx;
      }
      if (g.mode.includes("r")) w = Math.min(1 - x, Math.max(MIN, w + dx));
      if (g.mode.includes("t")) {
        const ny = Math.min(y + h - MIN, Math.max(0, y + dy));
        h += y - ny;
        y = ny;
      }
      if (g.mode.includes("b")) h = Math.min(1 - y, Math.max(MIN, h + dy));
    }
    setCrop({ x, y, w, h });
  }
  const up = () => (drag.current = null);

  function apply() {
    if (!natural) return;
    const sideways = rotate === 90 || rotate === 270;
    const cw = crop.w * natural.w, ch = crop.h * natural.h;
    const aspect = sideways ? ch / cw : cw / ch;
    const areaW = (d.w ?? 300) - 12;
    const extra = (d.h ?? 300) - areaW / currentAspect(d, natural);
    const round = (n: number) => Math.round(n * 10000) / 10000;
    onApply({
      crop: crop.w > 0.999 && crop.h > 0.999 ? undefined : { x: round(crop.x), y: round(crop.y), w: round(crop.w), h: round(crop.h) },
      rotate: rotate || undefined,
      h: Math.round(areaW / aspect + Math.max(16, extra)),
    });
  }

  const sideways = rotate === 90 || rotate === 270;
  const pw = 150;
  const ph = natural ? (sideways ? (crop.w * natural.w) / (crop.h * natural.h) : (crop.h * natural.h) / (crop.w * natural.w)) * pw : 100;

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog photo-editor" role="dialog" aria-modal="true" aria-label="Crop and rotate">
        <div className="dialog-head">
          <h2>Crop and rotate</h2>
          <button type="button" className="icon-btn sm" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="photo-edit-main">
          <div className="photo-crop" ref={box} style={{ width: dw, height: dh }} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={d.src} alt="" draggable={false} onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
            <div
              className="crop-rect"
              style={{ left: crop.x * dw, top: crop.y * dh, width: crop.w * dw, height: crop.h * dh }}
              onPointerDown={(e) => down(e, "move")}
            >
              {["tl", "tr", "bl", "br", "t", "b", "l", "r"].map((m) => (
                <span key={m} className={`crop-handle h-${m}`} onPointerDown={(e) => down(e, m)} />
              ))}
            </div>
          </div>
          <div className="photo-edit-side">
            <span className="field-label">Result</span>
            <div className="photo-preview" style={{ width: pw, height: ph, ["--frame-w" as string]: `${pw}px`, ["--frame-h" as string]: `${ph}px` }}>
              <PhotoFrame src={d.src} alt="Preview" crop={crop} rotate={rotate} />
            </div>
            <div className="photo-edit-buttons">
              <button type="button" className="btn" onClick={() => setRotate((r) => norm(r - 90))}>
                <Icon name="undo" size={16} /> Turn left
              </button>
              <button type="button" className="btn" onClick={() => setRotate((r) => norm(r + 90))}>
                <Icon name="redo" size={16} /> Turn right
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setCrop(FULL);
                  setRotate(0);
                }}
              >
                Reset
              </button>
            </div>
          </div>
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={apply} disabled={!natural}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

/** The shape the photo has on the board now (area width / area height). */
function currentAspect(d: ElementData, natural: { w: number; h: number }) {
  const c = d.crop ?? FULL;
  const r = norm(d.rotate);
  const cw = c.w * natural.w, ch = c.h * natural.h;
  return r === 90 || r === 270 ? ch / cw : cw / ch;
}
