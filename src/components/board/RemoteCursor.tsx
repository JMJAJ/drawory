"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { textOn } from "@/lib/client/identity";

/**
 * Someone else's cursor. Updates arrive a few times a second; between them the cursor glides
 * toward the latest position every frame, so it moves smoothly instead of jumping.
 */
export function RemoteCursor({ x, y, zoom, color, label, say }: { x: number; y: number; zoom: number; color: string; label: string; say?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const target = useRef({ x, y });
  const pos = useRef<{ x: number; y: number } | null>(null);
  const zoomRef = useRef(zoom);

  const paint = () => {
    const el = ref.current;
    const p = pos.current ?? target.current;
    if (el) el.style.transform = `translate(${p.x}px, ${p.y}px) scale(${1 / zoomRef.current})`;
  };

  // New target from the latest presence update. A big jump (they flew across the board) snaps.
  useLayoutEffect(() => {
    target.current = { x, y };
    const p = pos.current;
    if (!p || Math.hypot(p.x - x, p.y - y) * zoomRef.current > 1500) pos.current = { x, y };
    paint();
  }, [x, y]);

  useLayoutEffect(() => {
    zoomRef.current = zoom;
    paint();
  }, [zoom]);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      pos.current = null; // paint() then uses the target directly
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(100, t - last);
      last = t;
      const p = pos.current;
      const goal = target.current;
      if (p) {
        // Exponential smoothing: covers ~75% of the remaining distance every 60 ms.
        const k = 1 - Math.exp(-dt / 45);
        p.x += (goal.x - p.x) * k;
        p.y += (goal.y - p.y) * k;
        paint();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={ref} className="cursor">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 3l7 18 2.6-7.4L21 11z" fill={color} stroke="var(--surface)" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <div className="cursor-label" style={{ background: color, color: textOn(color) }}>
        {label}
      </div>
      {say && (
        <div className="cursor-say" style={{ background: color, color: textOn(color) }}>
          {say}
        </div>
      )}
    </div>
  );
}
