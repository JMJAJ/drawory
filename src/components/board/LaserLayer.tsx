"use client";

import { useEffect, useRef, useState } from "react";

/** How long a laser trail stays visible, in ms. */
const LIFE = 900;

type Point = { x: number; y: number; t: number };
type Trail = { color: string; pts: Point[] };

function frame(fn: () => void) {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    fn();
  };
  requestAnimationFrame(run);
  setTimeout(run, 40);
}

/**
 * Laser pointer trails (mine and everyone else's): a glowing line that fades within a second.
 * feeds: the recent points of each trail in world units; new points are stamped as they arrive.
 */
export function LaserLayer({ feeds, zoom }: { feeds: { key: string; color: string; pts: number[][] }[]; zoom: number }) {
  const trails = useRef(new Map<string, Trail>());
  const running = useRef(false);
  const [view, setView] = useState<{ now: number; trails: [string, Trail][] }>({ now: 0, trails: [] });

  useEffect(() => {
    const now = performance.now();
    for (const f of feeds) {
      const tr = trails.current.get(f.key) ?? { color: f.color, pts: [] };
      tr.color = f.color;
      const last = tr.pts[tr.pts.length - 1];
      // Only points we haven't seen yet (feeds repeat the last few).
      let from = 0;
      if (last) {
        for (let i = f.pts.length - 1; i >= 0; i--) {
          if (f.pts[i][0] === last.x && f.pts[i][1] === last.y) {
            from = i + 1;
            break;
          }
        }
      }
      for (const p of f.pts.slice(from)) tr.pts.push({ x: p[0], y: p[1], t: now });
      trails.current.set(f.key, tr);
    }
    if (running.current) return;
    running.current = true;
    const loop = () => {
      const t = performance.now();
      for (const [k, tr] of trails.current) {
        tr.pts = tr.pts.filter((p) => t - p.t < LIFE);
        if (!tr.pts.length) trails.current.delete(k);
      }
      setView({ now: t, trails: [...trails.current.entries()].map(([k, tr]) => [k, { color: tr.color, pts: [...tr.pts] }]) });
      if (trails.current.size) frame(loop);
      else running.current = false;
    };
    frame(loop);
  }, [feeds]);

  const width = 5 / Math.max(zoom, 0.2);
  return (
    <svg className="laser-layer" aria-hidden="true">
      {view.trails.map(([k, tr]) =>
        tr.pts.slice(1).map((p, i) => {
          const a = tr.pts[i];
          const life = Math.max(0, 1 - (view.now - p.t) / LIFE);
          return (
            <line
              key={`${k}-${i}`}
              x1={a.x}
              y1={a.y}
              x2={p.x}
              y2={p.y}
              stroke={tr.color}
              strokeWidth={width * (0.35 + 0.65 * life)}
              strokeLinecap="round"
              opacity={life}
              style={{ filter: `drop-shadow(0 0 ${4 / Math.max(zoom, 0.2)}px ${tr.color})` }}
            />
          );
        }),
      )}
    </svg>
  );
}
