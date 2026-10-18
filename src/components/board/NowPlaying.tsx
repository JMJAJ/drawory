"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { textOn } from "@/lib/client/identity";
import { liveProgress } from "@/lib/client/spotify";
import type { Listening } from "@/lib/types";

export interface PlayingItem {
  id: string;
  title: string;
  kind: "youtube" | "video" | "audio" | "spotify";
  /** Spotify songs: the song (not on the board). */
  spotify?: Listening;
  /** Who's playing it, me included. */
  people: { name: string; color: string; me: boolean }[];
  /** Page name when it isn't on the page I'm looking at. */
  elsewhere: string | null;
}

/** "Now playing" in the bottom bar: what's playing in the room, one click to go there. */
function SongRow({ it, onAddSong, who }: { it: PlayingItem; onAddSong?: (url: string) => void; who: string }) {
  const s = it.spotify!;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const pct = s.duration ? (liveProgress(s, now) / s.duration) * 100 : 0;
  return (
    <div className="now-item song">
      {s.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="song-art" src={s.image} alt="" />
      ) : (
        <span className="song-art" />
      )}
      <span className="now-item-text">
        <strong>{s.title}</strong>
        <span className="muted">
          {s.artists} · {who}
        </span>
        {s.duration > 0 && (
          <span className="song-bar">
            <span style={{ width: `${pct}%` }} />
          </span>
        )}
      </span>
      <span className="song-actions">
        {s.url && (
          <a className="icon-btn sm" href={s.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${s.title} in Spotify`} title="Open in Spotify">
            <Icon name="external" size={16} />
          </a>
        )}
        {s.url && onAddSong && (
          <button type="button" className="icon-btn sm" aria-label={`Put ${s.title} on the board`} title="Put it on the board" onClick={() => onAddSong(s.url!)}>
            <Icon name="plus" size={16} />
          </button>
        )}
      </span>
    </div>
  );
}

export function NowPlaying({ items, onJump, onAddSong }: { items: PlayingItem[]; onJump: (id: string) => void; onAddSong?: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  if (!items.length) return null;
  const first = items[0];
  const who = (p: PlayingItem["people"]) => p.map((x) => (x.me ? "you" : x.name)).join(", ");

  return (
    <div className="now-playing" ref={ref}>
      <button
        type="button"
        className="now-pill"
        aria-expanded={items.length > 1 || first.kind === "spotify" ? open : undefined}
        title={items.length > 1 || first.kind === "spotify" ? "See everything playing" : `Go to ${first.title}`}
        onClick={() => (items.length > 1 || first.kind === "spotify" ? setOpen((o) => !o) : onJump(first.id))}
      >
        <span className="eq" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="now-text">
          <span className="now-label">{items.length > 1 ? `${items.length} playing` : first.kind === "spotify" ? "Listening" : "Now playing"}</span>
          <span className="now-title">{first.title}</span>
        </span>
      </button>
      {open && (
        <div className="now-pop surface" role="dialog" aria-label="Playing now">
          {items.map((it) =>
            it.kind === "spotify" ? (
              <SongRow key={it.id} it={it} onAddSong={onAddSong} who={who(it.people)} />
            ) : (
            <button
              key={it.id}
              type="button"
              className="now-item"
              onClick={() => {
                onJump(it.id);
                setOpen(false);
              }}
            >
              <Icon name={it.kind === "youtube" ? "youtube" : it.kind === "video" ? "play" : "mic"} size={18} />
              <span className="now-item-text">
                <strong>{it.title}</strong>
                <span className="muted">
                  {who(it.people)}
                  {it.elsewhere ? ` · on ${it.elsewhere}` : ""}
                </span>
              </span>
              <span className="now-people" aria-hidden="true">
                {it.people.slice(0, 3).map((p, i) => (
                  <span key={i} className="avatar" style={{ background: p.color, color: textOn(p.color), width: 20, height: 20, fontSize: 10 }}>
                    {p.name.charAt(0).toUpperCase()}
                  </span>
                ))}
              </span>
            </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
