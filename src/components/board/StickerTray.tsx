"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { STICKERS, type Sticker } from "@/lib/stickers";

const RECENT_KEY = "drawory:recent-stickers";

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function StickerTray({ onPick, onClose }: { onPick: (s: Sticker) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  // localStorage is browser-only, so recents load after mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setRecent(loadRecent()), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest("[data-sticker-toggle]")) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [onClose]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? STICKERS.filter((s) => s.name.toLowerCase().includes(q)) : STICKERS;
  }, [query]);
  const recentStickers = recent.map((url) => STICKERS.find((s) => s.url === url)).filter((s): s is Sticker => !!s);

  function pick(s: Sticker) {
    const next = [s.url, ...recent.filter((u) => u !== s.url)].slice(0, 8);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {}
    onPick(s);
  }

  const grid = (items: Sticker[]) => (
    <div className="sticker-grid">
      {items.map((s) => (
        <button key={s.url} type="button" className="sticker-btn" title={s.name} aria-label={`Add sticker: ${s.name}`} onClick={() => pick(s)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={s.url} alt="" loading="lazy" draggable={false} />
        </button>
      ))}
    </div>
  );

  return (
    <div ref={ref} className="sticker-tray surface" role="dialog" aria-label="Stickers">
      <div className="sticker-search">
        <Icon name="sticker" size={18} style={{ color: "var(--muted)" }} />
        <label className="sr-only" htmlFor="sticker-q">
          Search stickers
        </label>
        <input id="sticker-q" autoFocus placeholder="Search stickers" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="sticker-scroll">
        {!query && recentStickers.length > 0 && (
          <>
            <h3>Recent</h3>
            {grid(recentStickers)}
            <h3>All stickers</h3>
          </>
        )}
        {list.length ? grid(list) : <p className="muted" style={{ margin: 8 }}>No stickers match “{query}”.</p>}
      </div>
    </div>
  );
}
