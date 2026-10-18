"use client";

import { useRef } from "react";
import { Icon } from "@/components/icons";
import { bounds, unionBounds, type Camera } from "@/lib/client/elements";
import type { ElementRow } from "@/lib/types";

const W = 200;
const H = 130;

const FILL: Partial<Record<ElementRow["type"], string>> = {
  window: "var(--accent)",
  chatbox: "var(--partner)",
  sticky: "#E39A1C",
  note: "#2E9E6A",
  image: "var(--muted)",
  video: "var(--muted)",
  youtube: "#E5484D",
  place: "transparent",
};

/** A small map of the page: everything on it and the part you're looking at. Click or drag to go. */
export function Minimap({
  rows,
  camera,
  onGo,
  onHide,
}: {
  rows: readonly ElementRow[];
  camera: Camera;
  onGo: (worldX: number, worldY: number) => void;
  onHide: () => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const view = { x: -camera.x / camera.zoom, y: -camera.y / camera.zoom, w: window.innerWidth / camera.zoom, h: window.innerHeight / camera.zoom };
  const all = unionBounds(rows) ?? view;
  // Fit everything and the view, with a margin.
  const x1 = Math.min(all.x, view.x), y1 = Math.min(all.y, view.y);
  const x2 = Math.max(all.x + all.w, view.x + view.w), y2 = Math.max(all.y + all.h, view.y + view.h);
  const pad = Math.max(x2 - x1, y2 - y1) * 0.06;
  const box = { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
  const s = Math.min(W / box.w, H / box.h);
  const ox = (W - box.w * s) / 2, oy = (H - box.h * s) / 2;
  const mx = (wx: number) => ox + (wx - box.x) * s;
  const my = (wy: number) => oy + (wy - box.y) * s;

  function go(e: React.PointerEvent) {
    const r = svg.current!.getBoundingClientRect();
    onGo(box.x + (e.clientX - r.left - ox) / s, box.y + (e.clientY - r.top - oy) / s);
  }

  return (
    <div className="minimap surface">
      <svg
        ref={svg}
        width={W}
        height={H}
        role="img"
        aria-label="Map of this page. Click to go somewhere."
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          go(e);
        }}
        onPointerMove={(e) => dragging.current && go(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        {rows.map((r) => {
          const b = bounds(r);
          return (
            <rect
              key={r.id}
              x={mx(b.x)}
              y={my(b.y)}
              width={Math.max(1.5, b.w * s)}
              height={Math.max(1.5, b.h * s)}
              rx={1}
              fill={FILL[r.type] ?? "var(--text)"}
              opacity={r.type === "stroke" ? 0.35 : 0.6}
              stroke={r.type === "place" ? "var(--region)" : "none"}
              strokeDasharray={r.type === "place" ? "2 2" : undefined}
            />
          );
        })}
        <rect x={mx(view.x)} y={my(view.y)} width={view.w * s} height={view.h * s} rx={2} fill="none" stroke="var(--text)" strokeWidth={1.5} />
      </svg>
      <button type="button" className="minimap-hide" aria-label="Hide the map" title="Hide the map" onClick={onHide}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}
