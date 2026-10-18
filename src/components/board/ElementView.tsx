"use client";

import { getStroke } from "perfect-freehand";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { bounds, colorValue, RESIZABLE } from "@/lib/client/elements";
import { stickerSrc } from "@/lib/stickers";
import type { ElementRow } from "@/lib/types";
import { useBoard } from "./context";
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
          thinning: 0.55,
          smoothing: 0.5,
          streamline: 0.45,
          simulatePressure: !(d.points ?? []).some((p) => p[2] !== 0.5),
        }),
      ),
    [d.points, d.size],
  );
  return (
    <svg className="el-svg" width={d.w} height={d.h}>
      <path className="hit" d={path} fill={colorValue(d.color)} />
    </svg>
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
  const common = { stroke, strokeWidth: sw, fill: "none", strokeDasharray: dash };
  const hit = { className: "hit-stroke", stroke: "transparent", strokeWidth: sw + 14, fill: "none" };
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
      style={{ fontSize: row.data.size ?? 28, color: colorValue(row.data.color) }}
      onBlur={(e) => editing && ctx.finishText(row.id, e.currentTarget.innerText)}
      onKeyDown={(e) => {
        if (e.key === "Escape") e.currentTarget.blur();
        e.stopPropagation();
      }}
    />
  );
}

function NoteView({ row, editing }: { row: ElementRow; editing: boolean }) {
  const ctx = useBoard();
  const items = row.data.items ?? [];
  const done = items.filter((i) => i.done).length;
  const [draft, setDraft] = useState("");
  const setItems = (next: typeof items, commit = true) => ctx.patch(row.id, { items: next }, commit);

  return (
    <div className="card note">
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
      {items.map((item) => (
        <div key={item.id} className={`check-row${item.done ? " done" : ""}`}>
          <button
            type="button"
            className="check-box"
            data-interactive
            aria-label={`${item.done ? "Uncheck" : "Check"} ${item.text}`}
            aria-pressed={item.done}
            onClick={() => setItems(items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)))}
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
                aria-label={`Remove ${item.text}`}
                onClick={() => setItems(items.filter((i) => i.id !== item.id))}
              >
                <Icon name="close" size={14} />
              </button>
            </>
          ) : (
            <span className="check-text">{item.text}</span>
          )}
        </div>
      ))}
      {editing && (
        <form
          className="check-row"
          onSubmit={(e) => {
            e.preventDefault();
            const text = draft.trim();
            if (!text) return;
            setItems([...items, { id: crypto.randomUUID(), text, done: false }]);
            setDraft("");
          }}
        >
          <span className="check-box" aria-hidden="true" />
          <input
            className="inline"
            aria-label="Add an item"
            placeholder="Add an item, press Enter"
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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={d.src} alt={d.caption || "Photo"} style={{ height: (d.h ?? 300) - (d.caption || editing ? 52 : 16) }} draggable={false} />
      {editing ? (
        <div className="media-caption">
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
  return (
    <div className="card media-card">
      <video src={d.src} controls playsInline preload="metadata" data-interactive style={{ height: (d.h ?? 300) - 16 }} />
    </div>
  );
}

function formatTime(s: number) {
  if (!Number.isFinite(s)) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function VoiceView({ row }: { row: ElementRow }) {
  const d = row.data;
  const audio = useRef<HTMLAudioElement>(null);
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
        {d.fromName ? `from ${d.fromName}` : "voice note"}
      </div>
      <audio
        ref={audio}
        src={d.src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
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
  const remoteUntil = useRef(0);
  const [playing, setPlaying] = useState(false);
  const { sendYt, onYt, setWatching, serverNow } = ctx;

  useEffect(() => {
    if (!d.videoId || !host.current) return;
    let cancelled = false;
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
          onStateChange: (e) => {
            const p = player.current;
            if (!p) return;
            const isPlaying = e.data === YT.PlayerState.PLAYING;
            if (e.data === YT.PlayerState.PLAYING || e.data === YT.PlayerState.PAUSED) {
              setPlaying(isPlaying);
              setWatching(isPlaying ? row.id : null);
              // Don't echo a change the other person just made.
              if (Date.now() > remoteUntil.current) {
                sendYt(row.id, { action: isPlaying ? "play" : "pause", time: p.getCurrentTime() });
              }
            }
          },
        },
      });
    });
    return () => {
      cancelled = true;
      player.current?.destroy();
      player.current = null;
      mount.remove();
      setWatching(null);
    };
  }, [d.videoId, row.id, sendYt, setWatching]);

  useEffect(
    () =>
      onYt(row.id, (cmd) => {
        const p = player.current;
        if (!p) return;
        remoteUntil.current = Date.now() + 1500;
        const lag = Math.min(3, Math.max(0, (serverNow() - cmd.sentAt) / 1000));
        const target = cmd.action === "play" ? cmd.time + lag : cmd.time;
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
  const height = (d.h ?? 300) - 74;

  return (
    <div className="card yt-card">
      <div className="yt-frame" style={{ height }}>
        {(together || partnerOnly) && (
          <div className="together-badge">
            <Icon name="sync" size={14} strokeWidth={2.4} />
            {together ? `Watching with ${names}` : `${names} ${others.length > 1 ? "are" : "is"} watching`}
          </div>
        )}
        <div ref={host} />
      </div>
      <div className="yt-meta">
        <div>
          <div className="yt-title">{d.title || "YouTube video"}</div>
          <div className="yt-sub">
            {together ? "In sync · you're both here" : "Play, pause and seek stay in sync"}
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

interface Props {
  row: ElementRow;
  selected: boolean;
  /** The only selected item: shows the resize handle. */
  solo?: boolean;
  editing: boolean;
  likes: number;
}

export const ElementView = memo(function ElementView({ row, selected, solo, editing, likes }: Props) {
  const b = bounds(row);
  const autoHeight = ["text", "note", "audio", "capsule", "link"].includes(row.type);
  const autoWidth = row.type === "text";
  const resizable = RESIZABLE[row.type];

  let content: React.ReactNode;
  switch (row.type) {
    case "stroke":
      content = <StrokeSvg row={row} />;
      break;
    case "rect":
    case "ellipse":
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
    case "place":
      content = <PlaceView row={row} />;
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
      className={`el el-${row.type}${selected ? " selected" : ""}`}
      style={{
        left: b.x,
        top: b.y,
        // The canvas layer has no width, so text must size itself to its content.
        width: autoWidth ? "max-content" : b.w,
        height: autoHeight ? undefined : b.h,
        zIndex: row.type === "place" ? 0 : Math.round(row.z) + 1,
        whiteSpace: autoWidth ? "pre" : undefined,
        pointerEvents: row.type === "place" ? "none" : undefined,
      }}
    >
      {content}
      {selected && solo && resizable && <div className="resize-handle" data-handle="resize" style={{ pointerEvents: "auto" }} />}
      {likes > 0 && (
        <div className="like-chip">
          <Icon name="heart" size={12} filled />
          {likes}
        </div>
      )}
    </div>
  );
});
