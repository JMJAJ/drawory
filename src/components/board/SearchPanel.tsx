"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import type { BoardPage, ChatRow, ElementRow } from "@/lib/types";

export interface SearchHit {
  key: string;
  /** The element to go to. */
  elementId: string;
  /** A chat message to flash, when the hit is a message. */
  messageId?: string;
  icon: IconName;
  title: string;
  snippet: string;
  page: string | null;
}

const ICON: Partial<Record<ElementRow["type"], IconName>> = {
  text: "text",
  sticky: "stickynote",
  note: "note",
  window: "window",
  link: "link",
  youtube: "youtube",
  chatbox: "chat",
  place: "pin",
  image: "image",
  audio: "mic",
  capsule: "capsule",
};

/** Every piece of text in an element, with a label for where it came from. */
function textsOf(r: ElementRow): { label: string; text: string }[] {
  const d = r.data;
  const out: { label: string; text: string }[] = [];
  const add = (label: string, text: string | undefined) => text && out.push({ label, text });
  add("Title", d.title);
  add("Text", d.text);
  add("Name", d.name);
  add("Caption", d.caption);
  add("Subtitle", d.subtitle);
  add("Link", d.url);
  for (const i of d.items ?? []) add("Item", i.text);
  for (const b of d.blocks ?? []) {
    add(b.title || "Block", b.title);
    add(b.title || "Text", b.text);
    add(b.title || "Link", b.url);
    for (const i of b.items ?? []) add(b.title || "Item", i.text);
  }
  return out;
}

function around(text: string, at: number, q: number) {
  const start = Math.max(0, at - 30);
  const end = Math.min(text.length, at + q + 50);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ")}${end < text.length ? "…" : ""}`;
}

/** Find anything on any page: text, lists, windows, links and chat messages. */
export function SearchPanel({
  rows,
  threads,
  homes,
  pages,
  onJump,
  onClose,
}: {
  rows: readonly ElementRow[];
  threads: ReadonlyMap<string, readonly ChatRow[]>;
  homes: ReadonlyMap<string, ElementRow>;
  pages: readonly BoardPage[];
  onJump: (hit: SearchHit) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const hits = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 2) return [];
    const pageName = (r: ElementRow) => pages.find((p) => p.id === (r.data.page ?? "main"))?.name ?? null;
    const out: SearchHit[] = [];
    for (const r of rows) {
      for (const t of textsOf(r)) {
        const at = t.text.toLowerCase().indexOf(term);
        if (at < 0) continue;
        out.push({
          key: `${r.id}:${out.length}`,
          elementId: r.id,
          icon: ICON[r.type] ?? "select",
          title: r.data.title || r.data.name || t.label,
          snippet: around(t.text, at, term.length),
          page: pageName(r),
        });
        break; // one hit per element is enough
      }
    }
    for (const [thread, msgs] of threads) {
      const home = homes.get(thread);
      if (!home) continue;
      for (const m of msgs) {
        const at = m.body.toLowerCase().indexOf(term);
        if (at < 0 || m.body.startsWith(":sticker:")) continue;
        out.push({
          key: `msg:${m.id}`,
          elementId: home.id,
          messageId: m.id,
          icon: "chat",
          title: `${m.name} in ${home.type === "chatbox" ? home.data.title || "Chat" : home.data.title || "a window"}`,
          snippet: around(m.body, at, term.length),
          page: pageName(home),
        });
        if (out.length > 80) break;
      }
    }
    return out.slice(0, 60);
  }, [q, rows, threads, homes, pages]);

  const sel = Math.min(active, Math.max(0, hits.length - 1));

  return (
    <div className="search-panel surface" role="dialog" aria-label="Search the board">
      <div className="search-row">
        <Icon name="search" size={18} />
        <input
          ref={input}
          aria-label="Search"
          placeholder="Search text, lists, windows and chats"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && hits[sel]) onJump(hits[sel]);
          }}
        />
        <button type="button" className="icon-btn sm" aria-label="Close search" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      {q.trim().length >= 2 && (
        <div className="search-results" role="listbox" aria-label="Results">
          {hits.length === 0 && <p className="muted search-empty">Nothing matches “{q.trim()}”.</p>}
          {hits.map((h, i) => (
            <button
              key={h.key}
              type="button"
              role="option"
              aria-selected={i === sel}
              className="search-hit"
              onMouseEnter={() => setActive(i)}
              onClick={() => onJump(h)}
            >
              <Icon name={h.icon} size={16} />
              <span className="search-hit-text">
                <strong>{h.title}</strong>
                <span className="muted">{h.snippet}</span>
              </span>
              {h.page && pages.length > 1 && <span className="search-page">{h.page}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
