"use client";

import { getStroke } from "perfect-freehand";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { bounds, colorValue, fontValue, RESIZABLE } from "@/lib/client/elements";
import { textOn } from "@/lib/client/identity";
import { proximityFactor, volumeKeeper, type Listener } from "@/lib/client/proximity";
import { stickerSrc } from "@/lib/stickers";
import type { ElementRow } from "@/lib/types";
import { ChatThread } from "./ChatThread";
import { WindowView } from "./WindowView";
import { GameView } from "./GameView";
import { PhotoFrame } from "./PhotoEditor";
import { useBoard } from "./context";
import { registerVideo, videoTime } from "@/lib/client/videoTimes";
import { loadYouTube, type YTPlayer } from "./youtube";

function svgPathFromStroke(stroke: number[][]) {
  if (stroke.length < 2) return "";
  const d: (string | number)[] = ["M", stroke[0][0].toFixed(1), stroke[0][1].toFixed(1), "Q"];
  for (let i = 0; i < stroke.length; i++) {
    const [x0, y0] = stroke[i];
    const [x1, y1] = stroke[(i + 1) % stroke.length];
    d.push(x0.toFixed(1), y0.toFixed(1), ((x0 + x1) / 2).toFixed(1), ((y0 + y1) / 2).toFixed(1));
  }
  d.push("Z");
  return d.join(" ");
}

export function StrokeSvg({ row }: { row: ElementRow }) {
  const d = row.data;
  const path = useMemo(
    () =>
      svgPathFromStroke(
        getStroke(d.points ?? [], {
          size: d.size ?? 6,
          // Highlighters are flat, like a marker.
          thinning: d.highlight ? 0 : 0.55,
          smoothing: 0.5,
          streamline: 0.45,
          simulatePressure: !d.highlight && !(d.points ?? []).some((p) => p[2] !== 0.5),
        }),
      ),
    [d.points, d.size, d.highlight],
  );
  // Fading ink: fade over its lifetime, picking up where it is now.
  const [elapsed] = useState(() => (d.fadeFrom ? Math.max(0, Date.now() - d.fadeFrom) : 0));
  const fade =
    d.fadeAt && d.fadeFrom
      ? { animation: `ink-fade ${d.fadeAt - d.fadeFrom}ms linear forwards`, animationDelay: `-${elapsed}ms` }
      : undefined;
  return (
    <svg className={`el-svg${d.highlight ? " highlight" : ""}`} width={d.w} height={d.h} style={fade}>
      <path className="hit" d={path} fill={colorValue(d.color)} />
    </svg>
  );
}

/** A drawing pinned to a moment of a video: it shows while the video is at that moment. */
function VideoNote({ row }: { row: ElementRow }) {
  const at = row.data.videoAt!;
  const [on, setOn] = useState(false);
  useEffect(() => {
    const check = () => {
      const t = videoTime(at.id);
      setOn(t !== null && t >= at.t - 0.3 && t <= at.t + 4);
    };
    check();
    const timer = setInterval(check, 250);
    return () => clearInterval(timer);
  }, [at.id, at.t]);
  return (
    <div className={`video-note${on ? " on" : ""}`}>
      <StrokeSvg row={row} />
    </div>
  );
}

function ShapeSvg({ row }: { row: ElementRow }) {
  const d = row.data;
  const w = d.w ?? 100;
  const h = d.h ?? 100;
  const sw = d.size ?? 3;
  const stroke = colorValue(d.color);
  const dash = d.dashed ? `${sw * 3} ${sw * 2.5}` : undefined;
  if (row.type === "arrow") {
    const [[x1, y1], [x2, y2]] = d.points ?? [[0, 0], [w, h]];
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = Math.max(12, sw * 4);
    const a1 = angle + Math.PI - 0.45;
    const a2 = angle + Math.PI + 0.45;
    const headPath = `M${x2 + head * Math.cos(a1)} ${y2 + head * Math.sin(a1)} L${x2} ${y2} L${x2 + head * Math.cos(a2)} ${y2 + head * Math.sin(a2)}`;
    return (
      <svg className="el-svg" width={w} height={h}>
        <path className="hit-stroke" d={`M${x1} ${y1} L${x2} ${y2}`} stroke="transparent" strokeWidth={sw + 14} fill="none" />
        <path d={`M${x1} ${y1} L${x2} ${y2}`} stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeDasharray={dash} fill="none" />
        <path d={headPath} stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    );
  }
  const inset = sw / 2;
  const filled = d.fill === "soft" || d.fill === "solid";
  const common = { stroke, strokeWidth: sw, fill: filled ? stroke : "none", fillOpacity: d.fill === "soft" ? 0.18 : 1, strokeDasharray: dash };
  // Filled shapes can be picked up anywhere inside; empty ones by their outline.
  const hit = filled
    ? { className: "hit", stroke: "transparent", strokeWidth: sw + 14, fill: "transparent" }
    : { className: "hit-stroke", stroke: "transparent", strokeWidth: sw + 14, fill: "none" };
  return (
    <svg className="el-svg" width={w} height={h}>
      {row.type === "rect" ? (
        <>
          <rect {...hit} x={inset} y={inset} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} rx={12} />
          <rect {...common} x={inset} y={inset} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} rx={12} />
        </>
      ) : (
        <>
          <ellipse {...hit} cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - inset)} ry={Math.max(0, h / 2 - inset)} />
          <ellipse {...common} cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - inset)} ry={Math.max(0, h / 2 - inset)} />
        </>
      )}
    </svg>
  );
}

/** A rectangle or ellipse, with optional words in the middle. */
function ShapeView({ row, editing }: { row: ElementRow; editing: boolean }) {
  const ctx = useBoard();
  const ref = useRef<HTMLDivElement>(null);
  const d = row.data;
  const solid = d.fill === "solid";
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !editing) return;
    el.innerText = d.text ?? "";
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    // Only when editing starts; typing shouldn't reset the box.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  return (
    <>
      <ShapeSvg row={row} />
      {(editing || d.text) && (
        <div className={`shape-text${solid ? " on-solid" : ""}`} style={{ color: solid ? "var(--bg)" : colorValue(d.color) }}>
          {editing ? (
            <div
              ref={ref}
              className="shape-text-edit"
              contentEditable
              suppressContentEditableWarning
              data-interactive
              role="textbox"
              aria-label="Text in the shape"
              onBlur={(e) => {
                const text = e.currentTarget.innerText.trim();
                if (text !== (d.text ?? "")) ctx.patch(row.id, { text });
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") ctx.stopEditing();
                e.stopPropagation();
              }}
            />
          ) : (
            <span>{d.text}</span>
          )}
        </div>
      )}
    </>
  );
}

function TextView({ row, editing }: { row: ElementRow; editing: boolean }) {
  const ctx = useBoard();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!editing || !el) return;
    // Focus after the click that created it has fully finished.
    const timer = setTimeout(() => {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
    return () => clearTimeout(timer);
  }, [editing]);
  // The browser owns the text while you type, so React never renders it as a child
  // (that would duplicate what you typed). It's written in here whenever you're not editing.
  const text = row.data.text ?? "";
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !editing && el.innerText !== text) el.innerText = text;
  }, [text, editing]);
  return (
    <div
      ref={ref}
      className="text-body"
      contentEditable={editing}
      suppressContentEditableWarning
      style={{ fontSize: row.data.size ?? 28, color: colorValue(row.data.color), fontFamily: fontValue(row.data.font) }}
      onInput={(e) => editing && ctx.reportTyping(row.id, e.currentTarget.innerText)}
      onBlur={(e) => editing && ctx.finishText(row.id, e.currentTarget.innerText)}
      onKeyDown={(e) => {
        if (e.key === "Escape") e.currentTarget.blur();
        e.stopPropagation();
      }}
    />
  );
}

/** Card colors for checklists ("" = plain). */
const NOTE_COLORS = [
  { id: "", label: "Plain", value: "var(--border-strong)" },
  { id: "rose", label: "Rose", value: "#E5484D" },
  { id: "amber", label: "Amber", value: "#E39A1C" },
  { id: "green", label: "Green", value: "#2E9E6A" },
  { id: "teal", label: "Teal", value: "#14A38F" },
  { id: "blue", label: "Blue", value: "#3B7BE0" },
  { id: "violet", label: "Violet", value: "#8E63DA" },
];
/** Tag chips get a color from their name, so the same tag always looks the same. */
const TAG_COLORS = ["#E5484D", "#E39A1C", "#2E9E6A", "#14A38F", "#3B7BE0", "#8E63DA", "#D6409F", "#7C8A1C"];
const TAG = /(^|\s)#([\p{L}\p{N}_-]{1,24})/gu;

function tagColor(tag: string) {
  let h = 0;
  for (const ch of tag.toLowerCase()) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}
function splitTags(text: string) {
  const tags = [...text.matchAll(TAG)].map((m) => m[2]);
  return { label: text.replace(TAG, "$1").replace(/\s{2,}/g, " ").trim(), tags };
}

function NoteView({ row, editing }: { row: ElementRow; editing: boolean }) {
  const ctx = useBoard();
  const items = row.data.items ?? [];
  const done = items.filter((i) => i.done).length;
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState<string | null>(null);
  const setItems = (next: typeof items, commit = true) => ctx.patch(row.id, { items: next }, commit);
  const card = NOTE_COLORS.find((c) => c.id === (row.data.color ?? "")) ?? NOTE_COLORS[0];

  const parsed = items.map((item) => ({ item, ...splitTags(item.text) }));
  const allTags = [...new Set(parsed.flatMap((p) => p.tags.map((t) => t.toLowerCase())))];
  const activeFilter = filter && allTags.includes(filter) ? filter : null;
  const shown = editing || !activeFilter ? parsed : parsed.filter((p) => p.tags.some((t) => t.toLowerCase() === activeFilter));

  return (
    <div className={`card note${card.id ? " tinted" : ""}`} style={{ ["--note" as string]: card.value }}>
      <div className="note-head">
        {editing ? (
          <input
            className="inline title"
            aria-label="List title"
            defaultValue={row.data.title}
            autoFocus
            data-interactive
            onBlur={(e) => ctx.patch(row.id, { title: e.target.value.trim() || "List" })}
            onKeyDown={(e) => e.stopPropagation()}
          />
        ) : (
          <div className="note-title">{row.data.title || "List"}</div>
        )}
        <div className="note-count">
          {done}/{items.length}
        </div>
      </div>
      <div className="progress">
        <div style={{ width: items.length ? `${(done / items.length) * 100}%` : 0 }} />
      </div>

      {editing && (
        <div className="note-colors" role="radiogroup" aria-label="List color">
          {NOTE_COLORS.map((c) => (
            <button
              key={c.id || "plain"}
              type="button"
              role="radio"
              aria-checked={card.id === c.id}
              aria-label={c.label}
              title={c.label}
              className="note-color"
              data-interactive
              style={{ background: c.value }}
              onClick={() => ctx.patch(row.id, { color: c.id })}
            />
          ))}
        </div>
      )}

      {!editing && allTags.length > 0 && (
        <div className="tag-filter" role="group" aria-label="Filter by tag">
          {allTags.map((t) => (
            <button
              key={t}
              type="button"
              className="tag"
              data-interactive
              aria-pressed={activeFilter === t}
              title={activeFilter === t ? "Show everything" : `Only show #${t}`}
              style={{ ["--tag" as string]: tagColor(t) }}
              onClick={() => setFilter(activeFilter === t ? null : t)}
            >
              #{t}
            </button>
          ))}
        </div>
      )}

      {shown.map(({ item, label, tags }) => (
        <div key={item.id} className={`check-row${item.done ? " done" : ""}`}>
          <button
            type="button"
            className="check-box"
            data-interactive
            aria-label={`${item.done ? "Uncheck" : "Check"} ${label}`}
            aria-pressed={item.done}
            onClick={() => ctx.edit(row.id, { k: "item-toggle", item: item.id })}
          >
            {item.done && <Icon name="check" size={13} strokeWidth={3.5} />}
          </button>
          {editing ? (
            <>
              <input
                className="inline"
                aria-label="Item"
                defaultValue={item.text}
                data-interactive
                onBlur={(e) => {
                  const text = e.target.value.trim();
                  if (text !== item.text) setItems(items.map((i) => (i.id === item.id ? { ...i, text } : i)).filter((i) => i.text));
                }}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <button
                type="button"
                className="icon-btn sm"
                data-interactive
                aria-label={`Remove ${label}`}
                onClick={() => setItems(items.filter((i) => i.id !== item.id))}
              >
                <Icon name="close" size={14} />
              </button>
            </>
          ) : (
            <span className="check-text">
              {label}
              {tags.map((t) => (
                <span key={t} className="tag small" style={{ ["--tag" as string]: tagColor(t) }}>
                  #{t}
                </span>
              ))}
            </span>
          )}
        </div>
      ))}
      {!editing && activeFilter && shown.length === 0 && <p className="muted note-empty">Nothing tagged #{activeFilter}.</p>}
      {editing && (
        <form
          className="check-row"
          onSubmit={(e) => {
            e.preventDefault();
            const text = draft.trim();
            if (!text) return;
            ctx.edit(row.id, { k: "item-add", item: { id: crypto.randomUUID(), text, done: false } });
            setDraft("");
          }}
        >
          <span className="check-box" aria-hidden="true" />
          <input
            className="inline"
            aria-label="Add an item"
            placeholder="Add an item · #tags work"
            value={draft}
            data-interactive
            autoFocus={items.length > 0}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") ctx.stopEditing();
              e.stopPropagation();
            }}
          />
        </form>
      )}
    </div>
  );
}

function ImageView({ row, editing }: { row: ElementRow; editing: boolean }) {
  const ctx = useBoard();
  const d = row.data;
  return (
    <div className="card media-card">
      <div
        className="photo-area"
        style={{
          height: (d.h ?? 300) - (d.caption || editing ? 52 : 16),
          ["--frame-w" as string]: `${(d.w ?? 300) - 12}px`,
          ["--frame-h" as string]: `${(d.h ?? 300) - (d.caption || editing ? 52 : 16)}px`,
        }}
      >
        <PhotoFrame src={d.src} alt={d.caption || "Photo"} crop={d.crop} rotate={d.rotate} />
      </div>
      {editing ? (
        <div className="media-caption">
          <button type="button" className="icon-btn sm" aria-label="Crop and rotate" title="Crop and rotate" data-interactive onClick={() => ctx.editPhoto(row.id)}>
            <Icon name="crop" size={18} />
          </button>
          <input
            className="input"
            aria-label="Caption"
            placeholder="Add a caption"
            defaultValue={d.caption}
            autoFocus
            data-interactive
            onBlur={(e) => ctx.patch(row.id, { caption: e.target.value.trim() })}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
              e.stopPropagation();
            }}
          />
        </div>
      ) : (
        d.caption && (
          <div className="media-caption">
            <strong>{d.caption}</strong>
          </div>
        )
      )}
    </div>
  );
}

function VideoView({ row }: { row: ElementRow }) {
  const d = row.data;
  const { setWatching } = useBoard();
  const video = useRef<HTMLVideoElement>(null);
  const keeper = useRef<((f: number) => void) | null>(null);
  const level = useProximity(row, (f) => {
    const v = video.current;
    if (!v) return;
    keeper.current ??= volumeKeeper(() => v.volume, (x) => (v.volume = x));
    keeper.current(f);
  });
  return (
    <div className="card media-card">
      <video
        ref={video}
        src={d.src}
        controls
        playsInline
        preload="metadata"
        data-interactive
        style={{ height: (d.h ?? 300) - 16 }}
        onPlay={() => setWatching(row.id)}
        onPause={() => setWatching(null)}
        onEnded={() => setWatching(null)}
      />
      <div className="media-volume">
        <VolumeChip level={level} />
      </div>
    </div>
  );
}

/**
 * Keeps a sound's volume matched to how far my view is from it (proximity audio).
 * Calls `apply` with 0..1 as I move around or the element moves; returns the level in 10% steps.
 */
function useProximity(row: ElementRow, apply: (factor: number) => void) {
  const { onListener } = useBoard();
  const b = bounds(row);
  const box = useRef(b);
  const applyRef = useRef(apply);
  const last = useRef<{ at: Listener; enabled: boolean } | null>(null);
  const [level, setLevel] = useState(100);
  const update = useRef(() => {});
  useEffect(() => {
    applyRef.current = apply;
    update.current = () => {
      const l = last.current;
      if (!l) return;
      const f = l.enabled ? proximityFactor(box.current, l.at) : 1;
      applyRef.current(f);
      setLevel(Math.round(f * 10) * 10);
    };
  });
  useEffect(
    () =>
      onListener((at, enabled) => {
        last.current = { at, enabled };
        update.current();
      }),
    [onListener],
  );
  // The element moved or was resized: recompute from where I already am.
  useEffect(() => {
    box.current = { x: b.x, y: b.y, w: b.w, h: b.h };
    update.current();
  }, [b.x, b.y, b.w, b.h]);
  return level;
}

function VolumeChip({ level }: { level: number }) {
  if (level >= 100) return null;
  return (
    <span className="volume-chip" title="Proximity audio: move closer to hear it louder">
      <Icon name={level === 0 ? "mute" : "volume"} size={13} />
      {level}%
    </span>
  );
}

function formatTime(s: number) {
  if (!Number.isFinite(s)) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function VoiceView({ row }: { row: ElementRow }) {
  const d = row.data;
  const { setWatching } = useBoard();
  const audio = useRef<HTMLAudioElement>(null);
  const keeper = useRef<((f: number) => void) | null>(null);
  const level = useProximity(row, (f) => {
    const a = audio.current;
    if (!a) return;
    keeper.current ??= volumeKeeper(() => a.volume, (x) => (a.volume = x));
    keeper.current(f);
  });
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const peaks = d.peaks?.length ? d.peaks : Array.from({ length: 32 }, () => 0.4);
  const color = d.color ?? "var(--partner)";
  return (
    <div className="card voice">
      <button
        type="button"
        className="voice-play"
        style={{ background: color }}
        data-interactive
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        onClick={() => {
          const a = audio.current;
          if (!a) return;
          if (a.paused) void a.play();
          else a.pause();
        }}
      >
        <Icon name={playing ? "pause" : "play"} size={16} />
      </button>
      <div className="wave" aria-hidden="true">
        {peaks.map((p, i) => (
          <span
            key={i}
            style={{ height: `${Math.max(12, p * 100)}%`, background: i / peaks.length < progress ? color : undefined }}
          />
        ))}
      </div>
      <div className="voice-meta">
        <strong>{formatTime(d.duration ?? 0)}</strong>
        <VolumeChip level={level} />
        {d.fromName ? `from ${d.fromName}` : "voice note"}
      </div>
      <audio
        ref={audio}
        src={d.src}
        preload="none"
        onPlay={() => {
          setPlaying(true);
          setWatching(row.id);
        }}
        onPause={() => {
          setPlaying(false);
          setWatching(null);
        }}
        onEnded={() => {
          setPlaying(false);
          setWatching(null);
          setProgress(0);
        }}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          setProgress(a.duration ? a.currentTime / a.duration : 0);
        }}
      />
    </div>
  );
}

function YouTubeView({ row }: { row: ElementRow }) {
  const ctx = useBoard();
  const d = row.data;
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  /** Ignore our own player's events briefly after applying someone else's command (no echo). */
  const remoteUntil = useRef(0);
  /** Whether I was the last to press play/pause; only that person sends the periodic time. */
  const leading = useRef(false);
  /** The latest shared playback state we heard, to join a video already in progress. */
  const shared = useRef<{ time: number; at: number; playing: boolean } | null>(null);
  const [playing, setPlaying] = useState(false);
  const { sendYt, onYt, setWatching, serverNow, patch } = ctx;
  const keeper = useRef<((f: number) => void) | null>(null);
  const factor = useRef(1);
  const level = useProximity(row, (f) => {
    factor.current = f;
    const p = player.current;
    if (!p) return;
    keeper.current ??= volumeKeeper(() => p.getVolume() / 100, (v) => p.setVolume(Math.round(v * 100)));
    keeper.current(f);
  });

  // Older cards were saved without a title: look it up once and save it for everyone.
  useEffect(() => {
    if (d.title || !d.url || ctx.readOnly) return;
    let cancelled = false;
    void fetch(`/api/unfurl?url=${encodeURIComponent(d.url)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        if (!cancelled && m?.title && m.title !== m.site) patch(row.id, { title: m.title });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [d.title, d.url, row.id, patch, ctx.readOnly]);

  useEffect(() => {
    if (!d.videoId || !host.current) return;
    let cancelled = false;
    let unregisterTime = () => {};
    const mount = document.createElement("div");
    host.current.appendChild(mount);
    loadYouTube().then((YT) => {
      if (cancelled) return;
      player.current = new YT.Player(mount, {
        videoId: d.videoId!,
        width: "100%",
        height: "100%",
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          // Start at the right volume for how far away it is.
          onReady: () => {
            const p = player.current;
            if (!p) return;
            unregisterTime = registerVideo(row.id, () => {
              const q = player.current;
              const s = q?.getPlayerState?.();
              // Only while it's playing or paused partway (not before it starts).
              return q && (s === 1 || s === 2) ? q.getCurrentTime() : null;
            });
            keeper.current = volumeKeeper(() => p.getVolume() / 100, (v) => p.setVolume(Math.round(v * 100)));
            keeper.current(factor.current);
          },
          onStateChange: (e) => {
            const p = player.current;
            if (!p) return;
            const isPlaying = e.data === YT.PlayerState.PLAYING;
            if (e.data !== YT.PlayerState.PLAYING && e.data !== YT.PlayerState.PAUSED) return;
            setPlaying(isPlaying);
            setWatching(isPlaying ? row.id : null);
            // A change the other person just made reached us: don't send it back.
            if (Date.now() < remoteUntil.current) return;
            const s = shared.current;
            const expected = s && s.playing ? s.time + (serverNow() - s.at) / 1000 : null;
            if (isPlaying && expected !== null && serverNow() - s!.at < 10_000) {
              // Someone is already watching: join them where they are instead of rewinding everyone.
              if (Math.abs(p.getCurrentTime() - expected) > 2) {
                remoteUntil.current = Date.now() + 1500;
                p.seekTo(expected, true);
              }
              return;
            }
            leading.current = true;
            sendYt(row.id, { action: isPlaying ? "play" : "pause", time: p.getCurrentTime() });
          },
        },
      });
    });
    return () => {
      cancelled = true;
      unregisterTime();
      player.current?.destroy();
      player.current = null;
      mount.remove();
      setWatching(null);
    };
  }, [d.videoId, row.id, sendYt, setWatching, serverNow]);

  // While I'm the one in charge and it's playing, share where we are every few seconds.
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      const p = player.current;
      if (p && leading.current) sendYt(row.id, { action: "tick", time: p.getCurrentTime() });
    }, 4_000);
    return () => clearInterval(t);
  }, [playing, row.id, sendYt]);

  useEffect(
    () =>
      onYt(row.id, (cmd) => {
        const lag = Math.min(3, Math.max(0, (serverNow() - cmd.sentAt) / 1000));
        const target = cmd.action === "pause" ? cmd.time : cmd.time + lag;
        shared.current = { time: target, at: serverNow(), playing: cmd.action !== "pause" };
        const p = player.current;
        if (!p) return;
        if (cmd.action === "tick") {
          // Only nudge someone who is watching and has drifted; never start or stop them.
          if (p.getPlayerState() === 1 && Math.abs(p.getCurrentTime() - target) > 2) {
            remoteUntil.current = Date.now() + 1500;
            p.seekTo(target, true);
          }
          return;
        }
        leading.current = false;
        remoteUntil.current = Date.now() + 1500;
        if (Math.abs(p.getCurrentTime() - target) > 1.2) p.seekTo(target, true);
        if (cmd.action === "play") p.playVideo();
        else p.pauseVideo();
      }),
    [onYt, row.id, serverNow],
  );

  const others = ctx.watchers[row.id] ?? [];
  const together = playing && others.length > 0;
  const partnerOnly = !playing && others.length > 0;
  const names = others.length > 2 ? `${others.slice(0, 2).join(", ")} +${others.length - 2}` : others.join(" & ");

  return (
    <div className="card yt-card">
      {/* Always 16:9, whatever width the card is resized to. */}
      <div className="yt-frame">
        {(together || partnerOnly) && (
          <div className="together-badge">
            <Icon name="sync" size={14} strokeWidth={2.4} />
            {together ? `Watching with ${names}` : `${names} ${others.length > 1 ? "are" : "is"} watching`}
          </div>
        )}
        <div ref={host} className="yt-host" />
      </div>
      <div className="yt-meta">
        <div>
          <div className="yt-title">{d.title || "YouTube video"}</div>
          <div className="yt-sub">
            {together ? `In sync with ${names}` : "Play, pause and seek stay in sync"} <VolumeChip level={level} />
          </div>
        </div>
        <Icon name="youtube" size={22} style={{ color: "var(--muted)", flex: "none" }} />
      </div>
    </div>
  );
}

function EmbedView({ row }: { row: ElementRow }) {
  const d = row.data;
  return (
    <div className="card embed-card" style={{ height: d.h }}>
      <iframe
        src={d.src}
        title={d.title || d.provider || "Embed"}
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
        data-interactive
      />
    </div>
  );
}

function LinkView({ row }: { row: ElementRow }) {
  const d = row.data;
  return (
    <div className="card link-card">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {d.image ? <img src={d.image} alt="" draggable={false} /> : null}
      <div className="link-row">
        {!d.image && (
          <div className="link-icon">
            <Icon name="link" />
          </div>
        )}
        <a className="open-link" href={d.url} target="_blank" rel="noopener noreferrer" data-interactive aria-label="Open link">
          <Icon name="external" size={18} />
        </a>
      </div>
      <div className="link-title">{d.title || d.url}</div>
      <div className="link-site">{d.site || d.url}</div>
    </div>
  );
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function CapsuleView({ row }: { row: ElementRow }) {
  const ctx = useBoard();
  const d = row.data;
  const now = useNow(30_000);
  const unlockAt = d.unlockAt ? new Date(d.unlockAt).getTime() : now;
  const left = Math.max(0, unlockAt - now);
  const unlocked = left === 0;
  const days = Math.floor(left / 86_400_000);
  const hrs = Math.floor((left % 86_400_000) / 3_600_000);
  const min = Math.floor((left % 3_600_000) / 60_000);
  const date = new Date(unlockAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="card capsule">
      <div className="capsule-top">
        <div className="capsule-icon">
          <Icon name={unlocked ? "unlock" : "lock"} size={18} strokeWidth={2.2} />
        </div>
        {!unlocked && (
          <div className="countdown" aria-label={`${days} days ${hrs} hours ${min} minutes left`}>
            <div>
              <b>{days}</b>
              <span>DAYS</span>
            </div>
            <div>
              <b>{String(hrs).padStart(2, "0")}</b>
              <span>HRS</span>
            </div>
            <div>
              <b>{String(min).padStart(2, "0")}</b>
              <span>MIN</span>
            </div>
          </div>
        )}
      </div>
      <div>
        <div className="eyebrow">{unlocked ? "Ready to open" : "Time capsule"}</div>
        <h3>{d.title || "Time capsule"}</h3>
        <div className="muted" style={{ fontSize: 13, marginTop: 3 }}>
          {unlocked ? `Sealed by ${d.sealedByName} · ` : `Opens ${date} · `}
          {d.count ?? 1} {d.count === 1 ? "thing" : "things"} inside
        </div>
      </div>
      {!ctx.readOnly && (
        <div className="capsule-actions">
          {unlocked ? (
            <button type="button" className="btn btn-primary" data-interactive onClick={() => ctx.openCapsule(row.id)}>
              Open it
            </button>
          ) : (
            <button type="button" className="btn" data-interactive onClick={() => ctx.addToCapsule(row.id)}>
              Slip a note in
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ChatBoxView({ row, editing }: { row: ElementRow; editing: boolean }) {
  const ctx = useBoard();
  const messages = ctx.chatFor(row.id);
  const unread = ctx.unread(row.id);
  return (
    <div className="card chatbox">
      <div className="chatbox-head">
        <Icon name="chat" size={16} />
        {editing ? (
          <input
            className="inline title"
            aria-label="Chat box name"
            defaultValue={row.data.title}
            autoFocus
            data-interactive
            maxLength={60}
            onBlur={(e) => ctx.patch(row.id, { title: e.target.value.trim() || "Chat" })}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
              e.stopPropagation();
            }}
          />
        ) : (
          <strong className="chatbox-title">{row.data.title || "Chat"}</strong>
        )}
        {unread.count > 0 ? (
          <span className={`unread-badge${unread.mention ? " mention" : ""}`} title={unread.mention ? "You were mentioned" : "Unread messages"}>
            {unread.mention ? "@" : ""}
            {unread.count}
          </span>
        ) : (
          <span className="chatbox-count muted">{messages.length || ""}</span>
        )}
      </div>
      <ChatThread
        messages={messages}
        me={ctx.me}
        readOnly={ctx.readOnly}
        onSend={(body) => ctx.sendChat(row.id, body)}
        onReact={ctx.react}
        onSeen={(id) => ctx.markSeen(row.id, id)}
        people={ctx.people}
        highlight={ctx.highlightMsg}
        roomEmojis={ctx.roomEmojis}
        inputId={`chatbox-${row.id}`}
        placeholder="Message"
      />
    </div>
  );
}

/** Paper colors for sticky notes; they stay light in both themes, with dark ink. */
export const STICKY_COLORS = [
  { id: "yellow", label: "Yellow", value: "#FFE58F" },
  { id: "pink", label: "Pink", value: "#FFC6D9" },
  { id: "blue", label: "Blue", value: "#C2E2FF" },
  { id: "green", label: "Green", value: "#C9F0C4" },
  { id: "purple", label: "Purple", value: "#E2D2FF" },
  { id: "orange", label: "Orange", value: "#FFD3AC" },
];

function StickyView({ row, editing }: { row: ElementRow; editing: boolean }) {
  const ctx = useBoard();
  const d = row.data;
  const paper = STICKY_COLORS.find((c) => c.id === d.color) ?? STICKY_COLORS[0];
  const text = d.text ?? "";
  // Bigger notes get bigger writing; long notes shrink a little to fit.
  const w = d.w ?? 200;
  const size = Math.round(Math.max(12, Math.min(48, (w / 9) * (text.length > 160 ? 0.62 : text.length > 70 ? 0.8 : 1))));
  return (
    <div className="sticky" style={{ background: paper.value }}>
      {editing ? (
        <textarea
          className="sticky-text"
          aria-label="Sticky note"
          defaultValue={text}
          autoFocus
          data-interactive
          maxLength={1000}
          placeholder="Write something…"
          style={{ fontSize: size }}
          onBlur={(e) => {
            if (e.target.value !== text) ctx.patch(row.id, { text: e.target.value });
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.blur();
            e.stopPropagation();
          }}
        />
      ) : (
        <div className="sticky-text" style={{ fontSize: size }}>
          {text || <span className="sticky-empty">Double-click to write</span>}
        </div>
      )}
      {editing && (
        <div className="sticky-colors" role="radiogroup" aria-label="Note color">
          {STICKY_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={paper.id === c.id}
              aria-label={c.label}
              title={c.label}
              className="sticky-color"
              data-interactive
              style={{ background: c.value }}
              // Keep the text box focused so its words aren't lost when picking a color.
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => ctx.patch(row.id, { color: c.id })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PlaceView({ row }: { row: ElementRow }) {
  return (
    <>
      <div className="place-region" />
      <div className="place-label" data-place-label>
        <Icon name="pin" size={13} strokeWidth={2.4} />
        {row.data.name || "Place"}
      </div>
    </>
  );
}

/** Someone else is acting on this element right now: shown in their color. */
export interface RemoteMark {
  color: string;
  name: string;
  mode: "live" | "erasing" | "typing";
}

interface Props {
  row: ElementRow;
  selected: boolean;
  remote?: RemoteMark;
  /** The only selected item: shows the resize handle. */
  solo?: boolean;
  editing: boolean;
  likes: number;
}

export const ElementView = memo(function ElementView({ row, selected, solo, editing, likes, remote }: Props) {
  const b = bounds(row);
  // A window sizes to its blocks until someone drags its height.
  const autoHeight = ["text", "note", "audio", "capsule", "link", "youtube"].includes(row.type) || (row.type === "window" && !row.data.h);
  const autoWidth = row.type === "text";
  const resizable = RESIZABLE[row.type];

  let content: React.ReactNode;
  switch (row.type) {
    case "stroke":
      content = row.data.videoAt ? <VideoNote row={row} /> : <StrokeSvg row={row} />;
      break;
    case "rect":
    case "ellipse":
      content = <ShapeView row={row} editing={editing} />;
      break;
    case "arrow":
      content = <ShapeSvg row={row} />;
      break;
    case "text":
      content = <TextView row={row} editing={editing} />;
      break;
    case "note":
      content = <NoteView row={row} editing={editing} />;
      break;
    case "image":
      content = <ImageView row={row} editing={editing} />;
      break;
    case "video":
      content = <VideoView row={row} />;
      break;
    case "audio":
      content = <VoiceView row={row} />;
      break;
    case "youtube":
      content = <YouTubeView row={row} />;
      break;
    case "embed":
      content = <EmbedView row={row} />;
      break;
    case "link":
      content = <LinkView row={row} />;
      break;
    case "capsule":
      content = <CapsuleView row={row} />;
      break;
    case "game":
      content = <GameView row={row} />;
      break;
    case "place":
      content = <PlaceView row={row} />;
      break;
    case "chatbox":
      content = <ChatBoxView row={row} editing={editing} />;
      break;
    case "sticky":
      content = <StickyView row={row} editing={editing} />;
      break;
    case "window":
      content = <WindowView row={row} editing={editing} />;
      break;
    case "sticker":
      // eslint-disable-next-line @next/next/no-img-element
      content = <img className="sticker-img" src={stickerSrc(row.data.src)} alt={row.data.name || "Sticker"} draggable={false} />;
      break;
  }

  return (
    <div
      data-el={row.id}
      data-type={row.type}
      className={`el el-${row.type}${selected ? " selected" : ""}${remote ? ` remote-${remote.mode}` : ""}`}
      style={{
        ["--rc" as string]: remote?.color,
        left: b.x,
        top: b.y,
        // The canvas layer has no width, so text must size itself to its content.
        width: autoWidth ? "max-content" : b.w,
        height: autoHeight ? undefined : b.h,
        zIndex: row.type === "place" || row.type === "game" ? 0 : Math.round(row.z) + 1,
        whiteSpace: autoWidth ? "pre" : undefined,
        opacity: row.data.opacity && row.data.opacity < 1 ? row.data.opacity : undefined,
        transform: row.data.angle ? `rotate(${row.data.angle}deg)` : undefined,
        pointerEvents: row.type === "place" || row.type === "game" ? "none" : undefined,
      }}
    >
      {content}
      {remote?.mode === "typing" && (
        <div className="remote-tag" style={{ background: remote.color, color: textOn(remote.color) }}>
          {remote.name} is typing
        </div>
      )}
      {selected && solo && resizable && !row.data.locked && <div className="resize-handle" data-handle="resize" style={{ pointerEvents: "auto" }} />}
      {selected && solo && !row.data.locked && row.type !== "place" && row.type !== "window" && row.type !== "game" && (
        <div className="rotate-handle" data-handle="rotate" title="Drag to turn (Shift: 15° steps)" style={{ pointerEvents: "auto" }} />
      )}
      {selected && row.data.locked && (
        <div className="lock-chip" title="Locked">
          <Icon name="lock" size={12} />
        </div>
      )}
      {likes > 0 && (
        <div className="like-chip">
          <Icon name="heart" size={12} filled />
          {likes}
        </div>
      )}
    </div>
  );
});
