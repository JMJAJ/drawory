"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { MAX_ZOOM, MIN_ZOOM } from "@/lib/client/elements";

const PRESETS = [25, 50, 75, 100, 150, 200, 400];
const LOG_MIN = Math.log(MIN_ZOOM);
const LOG_MAX = Math.log(MAX_ZOOM);
// The slider is logarithmic, so every part of it moves the zoom by a similar feel.
const toSlider = (z: number) => Math.round(((Math.log(z) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 1000);
const fromSlider = (v: number) => Math.exp(LOG_MIN + (v / 1000) * (LOG_MAX - LOG_MIN));

interface Props {
  zoom: number;
  /** Jump straight to a zoom (slider dragging). */
  onSet: (zoom: number) => void;
  /** Glide to a zoom (presets, typed value, buttons). */
  onGlide: (zoom: number) => void;
  onStep: (direction: 1 | -1) => void;
  onFitAll: () => void;
  onFitSelection: (() => void) | null;
}

export function ZoomControl({ zoom, onSet, onGlide, onStep, onFitAll, onFitSelection }: Props) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const pct = Math.round(zoom * 100);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };

  return (
    <div className="zoom-control" ref={ref}>
      <button type="button" className="icon-btn sm zoom-step" aria-label="Zoom out" title="Zoom out (Ctrl −)" onClick={() => onStep(-1)}>
        <Icon name="minus" size={18} />
      </button>
      <button
        type="button"
        className="zoom-label"
        aria-label={`Zoom ${pct}%. Open zoom options`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Zoom options"
        onClick={() => setOpen((o) => !o)}
      >
        {pct}%
      </button>
      <button type="button" className="icon-btn sm zoom-step" aria-label="Zoom in" title="Zoom in (Ctrl +)" onClick={() => onStep(1)}>
        <Icon name="plus" size={18} />
      </button>

      {open && (
        <div className="zoom-menu surface" role="dialog" aria-label="Zoom">
          <div className="zoom-menu-row">
            <label htmlFor="zoom-slider" className="sr-only">
              Zoom level
            </label>
            <input
              id="zoom-slider"
              className="zoom-slider"
              type="range"
              min={0}
              max={1000}
              step={1}
              value={toSlider(zoom)}
              onChange={(e) => onSet(fromSlider(Number(e.target.value)))}
            />
            <form
              className="zoom-exact"
              onSubmit={(e) => {
                e.preventDefault();
                const v = Number((typed ?? "").replace("%", ""));
                if (Number.isFinite(v) && v > 0) onGlide(v / 100);
                setTyped(null);
              }}
            >
              <label htmlFor="zoom-exact" className="sr-only">
                Exact zoom in percent
              </label>
              <input
                id="zoom-exact"
                inputMode="numeric"
                value={typed ?? String(pct)}
                onFocus={(e) => {
                  setTyped(String(pct));
                  e.target.select();
                }}
                onChange={(e) => setTyped(e.target.value)}
                onBlur={() => setTyped(null)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <span aria-hidden="true">%</span>
            </form>
          </div>
          <div className="zoom-presets" role="group" aria-label="Zoom presets">
            {PRESETS.map((p) => (
              <button key={p} type="button" aria-pressed={pct === p} onClick={() => onGlide(p / 100)}>
                {p}%
              </button>
            ))}
          </div>
          <div className="zoom-actions">
            <button type="button" onClick={pick(onFitAll)}>
              <span>Fit everything</span>
              <kbd>Shift 1</kbd>
            </button>
            <button type="button" disabled={!onFitSelection} onClick={onFitSelection ? pick(onFitSelection) : undefined}>
              <span>Fit selection</span>
              <kbd>Shift 2</kbd>
            </button>
            <button type="button" onClick={pick(() => onGlide(1))}>
              <span>Actual size (100%)</span>
              <kbd>Ctrl 0</kbd>
            </button>
          </div>
          <p className="zoom-hint">Ctrl + scroll or pinch to zoom where your pointer is.</p>
        </div>
      )}
    </div>
  );
}
