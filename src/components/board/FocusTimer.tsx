"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import type { FocusState } from "@/lib/types";

const FOCUS_MS = 25 * 60_000;
const BREAK_MS = 5 * 60_000;
const LONG_BREAK_MS = 15 * 60_000;

function chime(times = 2) {
  try {
    const ac = new AudioContext();
    for (let i = 0; i < times; i++) {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.frequency.value = i % 2 ? 660 : 880;
      g.gain.setValueAtTime(0.0001, ac.currentTime + i * 0.35);
      g.gain.exponentialRampToValueAtTime(0.2, ac.currentTime + i * 0.35 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + i * 0.35 + 0.3);
      o.connect(g).connect(ac.destination);
      o.start(ac.currentTime + i * 0.35);
      o.stop(ac.currentTime + i * 0.35 + 0.32);
    }
    setTimeout(() => void ac.close(), times * 400 + 200);
  } catch {}
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * A focus timer the whole room shares (25 minutes on, 5 off, a longer break every 4th time).
 * Anyone can start, pause or stop it; everyone sees the same countdown and hears the chime.
 */
export function FocusTimer({
  focus,
  serverNow,
  onChange,
  onLofi,
  readOnly,
}: {
  focus: FocusState | null;
  serverNow: () => number;
  onChange: (next: FocusState | null, ifEndsAt?: number | null) => void;
  onLofi: () => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tick = () => setNow(serverNow());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [serverNow]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  // Chime when the phase changes (for everyone, since everyone sees the change).
  const lastPhase = useRef<string | null>(null);
  useEffect(() => {
    const p = focus ? focus.phase : null;
    if (lastPhase.current && p && p !== lastPhase.current) chime(p === "break" ? 2 : 3);
    lastPhase.current = p;
  }, [focus]);

  // Time's up: move to the next phase (whoever notices first; the others' tries are ignored).
  const advanced = useRef<number | null>(null);
  useEffect(() => {
    if (!focus || readOnly || focus.pausedLeft || !focus.endsAt || now < focus.endsAt || advanced.current === focus.endsAt) return;
    advanced.current = focus.endsAt;
    const rounds = focus.phase === "focus" ? focus.rounds + 1 : focus.rounds;
    const next: FocusState =
      focus.phase === "focus"
        ? { phase: "break", endsAt: now + (rounds % 4 === 0 ? LONG_BREAK_MS : BREAK_MS), pausedLeft: null, rounds }
        : { phase: "focus", endsAt: now + FOCUS_MS, pausedLeft: null, rounds };
    onChange(next, focus.endsAt);
  }, [now, focus, onChange, readOnly]);

  if (!focus) {
    if (readOnly) return null;
    return (
      <button
        type="button"
        className="icon-btn surface theme-btn"
        aria-label="Start a focus timer for the room"
        title="Focus timer: 25 minutes on, 5 off, together"
        onClick={() => onChange({ phase: "focus", endsAt: serverNow() + FOCUS_MS, pausedLeft: null, rounds: 0 })}
      >
        <Icon name="clock" />
      </button>
    );
  }
  const left = focus.pausedLeft ?? (focus.endsAt ? focus.endsAt - now : 0);
  return (
    <div className="focus-wrap" ref={ref}>
      <button type="button" className={`pill focus-pill ${focus.phase}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="clock" size={16} />
        <span className="focus-phase">{focus.phase === "focus" ? "Focus" : "Break"}</span>
        <span className="focus-clock">{clock(left)}</span>
        {focus.pausedLeft ? <span className="muted">paused</span> : null}
      </button>
      {open && !readOnly && (
        <div className="focus-pop surface" role="dialog" aria-label="Focus timer">
          <p className="muted">
            {focus.phase === "focus" ? "Heads down. Everyone in the room sees this timer." : "Stretch, drink some water."} Round {focus.rounds + (focus.phase === "focus" ? 1 : 0)}.
          </p>
          <div className="focus-buttons">
            {focus.pausedLeft ? (
              <button type="button" className="btn btn-primary" onClick={() => onChange({ ...focus, endsAt: serverNow() + (focus.pausedLeft ?? 0), pausedLeft: null })}>
                Resume
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => onChange({ ...focus, pausedLeft: Math.max(1000, (focus.endsAt ?? 0) - serverNow()), endsAt: null })}>
                Pause
              </button>
            )}
            <button type="button" className="btn" onClick={() => onChange({ ...focus, endsAt: serverNow(), pausedLeft: null })}>
              Skip to {focus.phase === "focus" ? "break" : "focus"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => onChange(null)}>
              Stop
            </button>
          </div>
          <button
            type="button"
            className="btn btn-ghost focus-lofi"
            onClick={() => {
              onLofi();
              setOpen(false);
            }}
          >
            <Icon name="music" size={16} /> Add lo-fi radio to the board
          </button>
        </div>
      )}
    </div>
  );
}
