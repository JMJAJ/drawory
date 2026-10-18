"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { textOn } from "@/lib/client/identity";

export interface PlayingItem {
  id: string;
  title: string;
  kind: "youtube" | "video" | "audio";
  /** Who's playing it, me included. */
  people: { name: string; color: string; me: boolean }[];
  /** Page name when it isn't on the page I'm looking at. */
  elsewhere: string | null;
}

/** "Now playing" in the bottom bar: what's playing in the room, one click to go there. */
export function NowPlaying({ items, onJump }: { items: PlayingItem[]; onJump: (id: string) => void }) {
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
        aria-expanded={items.length > 1 ? open : undefined}
        title={items.length > 1 ? "See everything playing" : `Go to ${first.title}`}
        onClick={() => (items.length > 1 ? setOpen((o) => !o) : onJump(first.id))}
      >
        <span className="eq" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="now-text">
          <span className="now-label">{items.length > 1 ? `${items.length} playing` : "Now playing"}</span>
          <span className="now-title">{first.title}</span>
        </span>
      </button>
      {open && (
        <div className="now-pop surface" role="dialog" aria-label="Playing now">
          {items.map((it) => (
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
          ))}
        </div>
      )}
    </div>
  );
}
