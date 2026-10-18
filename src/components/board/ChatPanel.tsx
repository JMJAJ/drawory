"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { initials, textOn, type Me } from "@/lib/client/identity";
import type { ChatRow } from "@/lib/types";

interface Pending {
  key: string;
  body: string;
  /** The saved message's id, once the server confirms it. */
  id?: string;
  failed?: boolean;
}

function time(d: Date) {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** The room's chat. `messages` arrive newest first, straight from the live query. */
export function ChatPanel({
  messages,
  me,
  onClose,
  onSend,
}: {
  messages: readonly ChatRow[];
  me: Me;
  onClose: () => void;
  onSend: (body: string) => Promise<{ id: string }>;
}) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const ordered = [...messages].reverse();
  const savedIds = new Set(messages.map((m) => m.id));
  const waiting = pending.filter((p) => !p.id || !savedIds.has(p.id));

  // Stay scrolled to the newest message as new ones arrive.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, waiting.length]);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function send() {
    const body = draft.trim();
    if (!body) return;
    const key = crypto.randomUUID();
    setPending((p) => [...p, { key, body }]);
    setDraft("");
    onSend(body).then(
      (saved) => setPending((p) => p.map((x) => (x.key === key ? { ...x, id: saved.id } : x))),
      () => setPending((p) => p.map((x) => (x.key === key ? { ...x, failed: true } : x))),
    );
  }

  return (
    <aside className="chat surface" aria-label="Room chat">
      <div className="chat-head">
        <h2>Chat</h2>
        <button type="button" className="icon-btn sm" aria-label="Close chat" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className="chat-list" ref={listRef} role="log" aria-live="polite">
        {ordered.length === 0 && waiting.length === 0 && <p className="muted chat-empty">No messages yet. Say hi!</p>}
        {ordered.map((m, i) => {
          const mine = m.user_id === me.id;
          const prev = ordered[i - 1];
          const grouped = prev && prev.user_id === m.user_id && m.created_at.getTime() - prev.created_at.getTime() < 5 * 60_000;
          return (
            <div key={m.id} className={`chat-msg${mine ? " mine" : ""}${grouped ? " grouped" : ""}`}>
              {!grouped && !mine && (
                <div className="chat-who">
                  <span className="avatar chat-avatar" style={{ background: m.color, color: textOn(m.color) }}>
                    {initials(m.name)}
                  </span>
                  <strong>{m.name}</strong>
                  <span className="muted">{time(m.created_at)}</span>
                </div>
              )}
              {!grouped && mine && <div className="chat-who mine-time muted">{time(m.created_at)}</div>}
              <div className="chat-bubble">{m.body}</div>
            </div>
          );
        })}
        {waiting.map((p) => (
          <div key={p.key} className={`chat-msg mine${p.failed ? " failed" : " sending"}`}>
            <div className="chat-bubble">{p.body}</div>
            {p.failed && (
              <button
                type="button"
                className="chat-retry"
                onClick={() => {
                  setPending((list) => list.filter((x) => x.key !== p.key));
                  setDraft(p.body);
                }}
              >
                Didn&apos;t send · tap to edit and retry
              </button>
            )}
          </div>
        ))}
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <label htmlFor="chat-input" className="sr-only">
          Message
        </label>
        <textarea
          id="chat-input"
          ref={inputRef}
          rows={1}
          maxLength={2000}
          placeholder="Message the room"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="submit" className="icon-btn chat-send" aria-label="Send" disabled={!draft.trim()}>
          <Icon name="send" size={18} />
        </button>
      </form>
    </aside>
  );
}
