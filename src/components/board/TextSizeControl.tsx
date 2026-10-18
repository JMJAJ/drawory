"use client";

import { useState } from "react";

const STEPS = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 88, 104, 128, 160, 200, 240];
export const MIN_TEXT = 8;
export const MAX_TEXT = 240;

/** "A− [28] A+": steps through common sizes, or type any size. */
export function TextSizeControl({ size, onChange }: { size: number; onChange: (size: number) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? STEPS.find((s) => s > size) ?? MAX_TEXT : [...STEPS].reverse().find((s) => s < size) ?? MIN_TEXT;
    onChange(next);
  };
  const commit = () => {
    const v = Math.round(Number(typed));
    if (typed !== null && Number.isFinite(v) && v > 0) onChange(Math.min(MAX_TEXT, Math.max(MIN_TEXT, v)));
    setTyped(null);
  };
  return (
    <div className="text-size" role="group" aria-label="Text size">
      <button type="button" className="text-size-btn" aria-label="Smaller text" title="Smaller text" disabled={size <= MIN_TEXT} onClick={() => step(-1)}>
        <span style={{ fontSize: 12 }}>A</span>−
      </button>
      <label htmlFor="text-size-input" className="sr-only">
        Text size in pixels
      </label>
      <input
        id="text-size-input"
        className="text-size-input"
        inputMode="numeric"
        value={typed ?? String(Math.round(size))}
        onFocus={(e) => {
          setTyped(String(Math.round(size)));
          e.target.select();
        }}
        onChange={(e) => setTyped(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            step(e.key === "ArrowUp" ? 1 : -1);
            setTyped(null);
          }
        }}
      />
      <button type="button" className="text-size-btn" aria-label="Bigger text" title="Bigger text" disabled={size >= MAX_TEXT} onClick={() => step(1)}>
        <span style={{ fontSize: 16 }}>A</span>+
      </button>
    </div>
  );
}
