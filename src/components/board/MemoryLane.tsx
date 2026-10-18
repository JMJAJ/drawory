"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { api } from "@/lib/client/api";
import type { ElementRow, HistoryEvent } from "@/lib/types";

const SPEEDS = [1, 4, 16];
const BARS = 60;

function milestoneLabel(e: HistoryEvent) {
  switch (e.type) {
    case "place":
      return `New place: ${e.data?.name ?? ""}`.trim();
    case "capsule":
      return "Capsule sealed";
    case "image":
      return "A photo";
    case "video":
      return "A video";
    case "youtube":
      return "Watch night";
    case "audio":
      return "Voice note";
    default:
      return null;
  }
}

export function MemoryLane({
  boardId,
  partnerName,
  theme,
  onToggleTheme,
  onRows,
  onClose,
}: {
  boardId: string;
  partnerName: string | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onRows: (rows: ElementRow[]) => void;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<HistoryEvent[] | null>(null);
  const [error, setError] = useState("");
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(4);
  const cache = useRef<{ index: number; map: Map<string, ElementRow> }>({ index: 0, map: new Map() });

  useEffect(() => {
    api.history(boardId).then(setEvents, (e) => setError(e instanceof Error ? e.message : "Couldn't load history"));
  }, [boardId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const n = events?.length ?? 0;
  const times = useMemo(() => (events ?? []).map((e) => new Date(e.created_at).getTime()), [events]);
  const t0 = times[0] ?? 0;
  const t1 = times[n - 1] ?? 1;
  const span = Math.max(1, t1 - t0);
  const pct = (t: number) => ((t - t0) / span) * 100;
  const currentTime = pos > 0 ? times[pos - 1] : t0;

  // Rebuild the board as it was after `pos` events. Moving forward only applies the new ones.
  useEffect(() => {
    if (!events) return;
    const c = cache.current;
    if (pos < c.index) {
      c.index = 0;
      c.map = new Map();
    }
    for (let i = c.index; i < pos; i++) {
      const e = events[i];
      if (e.op === "delete") c.map.delete(e.element_id);
      else if (e.type && e.data) {
        const prev = c.map.get(e.element_id);
        const at = new Date(e.created_at);
        c.map.set(e.element_id, {
          id: e.element_id,
          type: e.type,
          data: e.data,
          z: e.z ?? 0,
          created_by: e.author,
          created_at: prev?.created_at ?? at,
          updated_at: at,
        });
      }
    }
    c.index = pos;
    onRows([...c.map.values()].sort((a, b) => a.z - b.z));
  }, [events, pos, onRows]);

  useEffect(() => {
    if (!playing || !events || pos >= n) return;
    const perTick = Math.max(1, Math.round((speed * Math.max(1, n / 1200)) / 2));
    const t = setTimeout(() => setPos((p) => Math.min(n, p + perTick)), 50);
    return () => clearTimeout(t);
  }, [playing, pos, n, speed, events]);

  const bars = useMemo(() => {
    const counts = Array<number>(BARS).fill(0);
    for (const t of times) counts[Math.min(BARS - 1, Math.floor(((t - t0) / span) * BARS))]++;
    const max = Math.max(1, ...counts);
    return counts.map((c, i) => ({ h: c ? Math.max(6, (c / max) * 50) : 3, end: t0 + ((i + 1) / BARS) * span }));
  }, [times, t0, span]);

  const marks = useMemo(() => {
    if (!events?.length) return [];
    const seen = new Set<string>();
    const candidates: { index: number; label: string; t: number }[] = [{ index: 1, label: "The first stroke", t: times[0] }];
    events.forEach((e, i) => {
      if (e.op !== "upsert" || seen.has(e.element_id)) return;
      seen.add(e.element_id);
      const label = milestoneLabel(e);
      if (label && i > 0) candidates.push({ index: i + 1, label, t: times[i] });
    });
    // Keep at most 5, spread out and not overlapping on the track.
    const picked: typeof candidates = [];
    for (const c of candidates) {
      if (picked.every((p) => Math.abs(pct(p.t) - pct(c.t)) > 14)) picked.push(c);
      if (picked.length === 5) break;
    }
    return picked;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, times, span]);

  const current = [...marks].reverse().find((m) => m.index <= pos);
  const addedThatWeek = useMemo(() => {
    if (!events) return 0;
    const seen = new Set<string>();
    let count = 0;
    for (let i = 0; i < pos; i++) {
      const e = events[i];
      if (e.op !== "upsert" || seen.has(e.element_id)) continue;
      seen.add(e.element_id);
      if (times[i] > currentTime - 7 * 86_400_000) count++;
    }
    return count;
  }, [events, pos, times, currentTime]);

  const dateLabel = new Date(currentTime || t1).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  return (
    <>
      <div className="hud topbar">
        <div className="pill" style={{ paddingRight: 14 }}>
          <button type="button" className="icon-btn" aria-label="Back to now" onClick={onClose}>
            <Icon name="back" />
          </button>
          <strong style={{ fontSize: 16, letterSpacing: "-0.02em" }}>Memory lane</strong>
        </div>
        <div className="pill lane-banner">
          <Icon name="history" size={18} style={{ color: "var(--accent)" }} />
          <strong>Replaying your board</strong>
          <span className="muted lane-sub">· {partnerName ? `everything you and ${partnerName} made` : "everything you've made"}</span>
        </div>
        <button
          type="button"
          className="icon-btn surface theme-btn"
          aria-label={theme === "dark" ? "Switch to day" : "Switch to night"}
          onClick={onToggleTheme}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
      </div>

      <div className="hud timeline surface">
        {error ? (
          <p className="form-error">{error}</p>
        ) : !events ? (
          <p className="muted">Loading your history…</p>
        ) : n === 0 ? (
          <p className="muted">Nothing here yet. Draw something and come back.</p>
        ) : (
          <>
            <div className="timeline-head">
              <button
                type="button"
                className="play-btn"
                aria-label={playing && pos < n ? "Pause replay" : "Play replay"}
                onClick={() => {
                  if (pos >= n) {
                    setPos(0);
                    setPlaying(true);
                  } else setPlaying((p) => !p);
                }}
              >
                <Icon name={playing && pos < n ? "pause" : "play"} />
              </button>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div className="eyebrow">
                  {dateLabel} · {addedThatWeek} {addedThatWeek === 1 ? "thing" : "things"} added that week
                </div>
                <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: "-0.02em" }}>
                  {current ? `The week of “${current.label}”` : "The very beginning"}
                </div>
              </div>
              <div className="speed-group" role="group" aria-label="Replay speed">
                {SPEEDS.map((s) => (
                  <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                    {s}×
                  </button>
                ))}
              </div>
              <button type="button" className="btn" onClick={onClose}>
                Back to now
              </button>
            </div>
            <div className="track">
              <div className="marks">
                {marks.map((m) => (
                  <button
                    key={m.index}
                    type="button"
                    className="mark"
                    aria-pressed={current?.index === m.index}
                    style={{ left: `${Math.min(92, Math.max(6, pct(m.t)))}%` }}
                    onClick={() => {
                      setPlaying(false);
                      setPos(m.index);
                    }}
                  >
                    <i />
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="bars" aria-hidden="true">
                {bars.map((b, i) => (
                  <span key={i} className={b.end <= currentTime + span / BARS ? "on" : ""} style={{ height: b.h }} />
                ))}
              </div>
              <div className="playhead" style={{ left: `${pct(currentTime)}%` }} />
              <input
                className="scrub"
                type="range"
                min={0}
                max={n}
                value={pos}
                aria-label="Replay position"
                onChange={(e) => {
                  setPlaying(false);
                  setPos(Number(e.target.value));
                }}
              />
              <div className="track-ends">
                <span>{new Date(t0).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
                <span>today</span>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
