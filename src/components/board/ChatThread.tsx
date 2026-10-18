"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { initials, textOn, type Me } from "@/lib/client/identity";
import { EMOJIS, findEmoji, searchEmojis } from "@/lib/emojis";
import { mentions, REACTIONS } from "@/lib/reactions";
import { STICKERS } from "@/lib/stickers";
import type { ChatRow } from "@/lib/types";
import { StickerTray } from "./StickerTray";

/** A sticker is sent as this prefix plus the sticker's address; only built-in stickers show as images. */
const STICKER_PREFIX = ":sticker:";
function stickerIn(body: string) {
  return body.startsWith(STICKER_PREFIX) ? STICKERS.find((s) => s.url === body.slice(STICKER_PREFIX.length)) : undefined;
}

/** @names and :emoji: in a message. */
const TOKENS = /(@[\p{L}\p{N}_.-]+|:[A-Za-z0-9_]{2,40}:)/gu;

function Bubble({ body }: { body: string }) {
  const sticker = stickerIn(body);
  if (!sticker) {
    const pieces = body.split(TOKENS).map((p, i) => {
      if (i % 2 === 0) return { text: p };
      if (p.startsWith("@")) return { mention: p };
      const emoji = findEmoji(p.slice(1, -1));
      return emoji ? { emoji, code: p } : { text: p };
    });
    // A message of just a few emojis shows them big, like Discord does.
    const emojiCount = pieces.filter((x) => "emoji" in x).length;
    const jumbo = emojiCount > 0 && emojiCount <= 6 && pieces.every((x) => "emoji" in x || ("text" in x && !(x.text ?? "").trim()));
    return (
      <div className={`chat-bubble${jumbo ? " jumbo" : ""}`}>
        {pieces.map((x, i) =>
          "emoji" in x && x.emoji ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} className="chat-emoji" src={x.emoji.url} alt={x.code} title={x.code} loading="lazy" draggable={false} />
          ) : "mention" in x ? (
            <span key={i} className="chat-mention">
              {x.mention}
            </span>
          ) : (
            <Fragment key={i}>{x.text}</Fragment>
          ),
        )}
      </div>
    );
  }
  return (
    <div className="chat-bubble sticker">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="chat-sticker" src={sticker.url} alt={`Sticker: ${sticker.name}`} title={sticker.name} loading="lazy" draggable={false} />
    </div>
  );
}

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

/** The @word being typed at the end of the draft, if any. */
function mentionDraft(draft: string) {
  const m = /(^|\s)@([\p{L}\p{N}_.-]*)$/u.exec(draft);
  return m ? m[2] : null;
}

/**
 * One conversation: the messages (newest first, as the live query returns them) and a box to
 * write in. Used by every chat box on the board and chat blocks in windows.
 */
export function ChatThread({
  messages,
  me,
  onSend,
  onReact,
  onSeen,
  people = [],
  highlight,
  readOnly,
  autoFocus,
  inputId,
  placeholder = "Message the room",
}: {
  messages: readonly ChatRow[];
  me: Me;
  onSend: (body: string) => Promise<{ id: string }>;
  onReact?: (id: string, emoji: string) => void;
  /** Called with the newest message's id while the conversation is on screen. */
  onSeen?: (newestId: string) => void;
  /** Who can be @mentioned. */
  people?: readonly { name: string; color: string }[];
  /** A message to scroll to and flash (from "jump to message"). */
  highlight?: string | null;
  readOnly?: boolean;
  autoFocus?: boolean;
  inputId: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [stickers, setStickers] = useState(false);
  const [emojiPicker, setEmojiPicker] = useState(false);
  const [emojiQuery, setEmojiQuery] = useState("");
  const [picker, setPicker] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const ordered = [...messages].reverse();
  const savedIds = new Set(messages.map((m) => m.id));
  const waiting = pending.filter((p) => !p.id || !savedIds.has(p.id));
  const newest = messages[0]?.id;

  // Stay scrolled to the newest message as new ones arrive.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, waiting.length]);

  // Jump to a message: scroll it into the middle and flash it.
  useEffect(() => {
    if (!highlight) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-msg="${highlight}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  }, [highlight, messages.length]);

  // While this conversation is on screen (and the tab is open), its messages count as read.
  const onSeenRef = useRef(onSeen);
  useEffect(() => {
    onSeenRef.current = onSeen;
  });
  const tracksSeen = !!onSeen;
  useEffect(() => {
    const el = listRef.current;
    if (!el || !tracksSeen || !newest) return;
    let visible = false;
    const report = () => visible && document.visibilityState === "visible" && onSeenRef.current?.(newest);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio > 0.3;
      report();
    }, { threshold: [0, 0.3, 0.6] });
    io.observe(el);
    document.addEventListener("visibilitychange", report);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", report);
    };
  }, [newest, tracksSeen]);

  const typingMention = mentionDraft(draft);
  const typingEmoji = /(^|\s):([A-Za-z0-9_]{2,40})$/.exec(draft)?.[2] ?? null;
  type Suggestion = { kind: "person"; name: string; color: string } | { kind: "emoji"; name: string; url: string };
  const suggestions: Suggestion[] =
    typingEmoji !== null
      ? searchEmojis(typingEmoji, 8).map((e) => ({ kind: "emoji" as const, ...e }))
      : typingMention === null
        ? []
        : [{ name: "everyone", color: "var(--muted)" }, ...people]
            .filter((p) => p.name.toLowerCase().replace(/\s+/g, "").startsWith(typingMention.toLowerCase()))
            .slice(0, 5)
            .map((p) => ({ kind: "person" as const, ...p }));
  function pick(s: Suggestion) {
    if (s.kind === "emoji") setDraft((d) => d.replace(/:([A-Za-z0-9_]*)$/, `:${s.name}: `));
    else setDraft((d) => d.replace(/@([\p{L}\p{N}_.-]*)$/u, `@${s.name.split(/\s+/)[0]} `));
    document.getElementById(inputId)?.focus();
  }
  const pickerList = emojiPicker ? (emojiQuery.trim() ? searchEmojis(emojiQuery.trim(), 400) : EMOJIS) : [];

  function send(text = draft) {
    const body = text.trim();
    if (!body) return;
    const key = crypto.randomUUID();
    setPending((p) => [...p, { key, body }]);
    if (text === draft) setDraft("");
    onSend(body).then(
      (saved) => setPending((p) => p.map((x) => (x.key === key ? { ...x, id: saved.id } : x))),
      () => setPending((p) => p.map((x) => (x.key === key ? { ...x, failed: true } : x))),
    );
  }

  return (
    <>
      {/* data-interactive: scroll and select text here instead of dragging the board. */}
      <div className="chat-list" ref={listRef} role="log" aria-live="polite" data-interactive>
        {ordered.length === 0 && waiting.length === 0 && <p className="muted chat-empty">No messages yet. Say hi!</p>}
        {ordered.map((m, i) => {
          const mine = m.user_id === me.id;
          const prev = ordered[i - 1];
          const grouped = prev && prev.user_id === m.user_id && m.created_at.getTime() - prev.created_at.getTime() < 5 * 60_000;
          const reactions = Object.entries(m.reactions ?? {}).filter(([, who]) => who.length > 0);
          const forMe = !mine && mentions(m.body, me.name);
          return (
            <div key={m.id} data-msg={m.id} className={`chat-msg${mine ? " mine" : ""}${grouped ? " grouped" : ""}${forMe ? " for-me" : ""}`}>
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
              <div className="chat-line">
                <Bubble body={m.body} />
                {onReact && !readOnly && (
                  <button
                    type="button"
                    className="chat-react-btn"
                    data-interactive
                    aria-label="React"
                    aria-expanded={picker === m.id}
                    onClick={() => setPicker((p) => (p === m.id ? null : m.id))}
                  >
                    <Icon name="heart" size={14} />
                  </button>
                )}
              </div>
              {picker === m.id && (
                <div className="chat-react-pick" role="group" aria-label="Pick a reaction" data-interactive>
                  {REACTIONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      data-interactive
                      onClick={() => {
                        onReact?.(m.id, r);
                        setPicker(null);
                      }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}
              {reactions.length > 0 && (
                <div className="chat-reactions">
                  {reactions.map(([emoji, who]) => (
                    <button
                      key={emoji}
                      type="button"
                      className="chat-reaction"
                      data-interactive
                      aria-pressed={who.includes(me.id)}
                      disabled={readOnly || !onReact}
                      title={`${who.length} ${who.length === 1 ? "reaction" : "reactions"}`}
                      onClick={() => onReact?.(m.id, emoji)}
                    >
                      {emoji} <span>{who.length}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {waiting.map((p) => (
          <div key={p.key} className={`chat-msg mine${p.failed ? " failed" : " sending"}`}>
            <Bubble body={p.body} />
            {p.failed && (
              <button
                type="button"
                className="chat-retry"
                data-interactive
                onClick={() => {
                  setPending((list) => list.filter((x) => x.key !== p.key));
                  if (stickerIn(p.body)) send(p.body);
                  else setDraft(p.body);
                }}
              >
                Didn&apos;t send · tap to edit and retry
              </button>
            )}
          </div>
        ))}
      </div>
      {!readOnly && (
        <form
          className="chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          {stickers && (
            <div className="chat-sticker-pop" data-interactive>
              <StickerTray
                onClose={() => setStickers(false)}
                onPick={(s) => {
                  setStickers(false);
                  send(STICKER_PREFIX + s.url);
                }}
              />
            </div>
          )}
          {suggestions.length > 0 && (
            <div className="chat-mention-pop" role="listbox" aria-label={typingEmoji !== null ? "Emojis" : "Mention someone"} data-interactive>
              {suggestions.map((s) => (
                <button key={s.name} type="button" role="option" aria-selected={false} data-interactive onClick={() => pick(s)}>
                  {s.kind === "emoji" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="chat-emoji" src={s.url} alt="" loading="lazy" />
                  ) : (
                    <span className="avatar chat-avatar" style={{ background: s.color, color: s.name === "everyone" ? "var(--surface)" : textOn(s.color) }}>
                      {s.name === "everyone" ? "@" : initials(s.name)}
                    </span>
                  )}
                  {s.kind === "emoji" ? `:${s.name}:` : s.name}
                </button>
              ))}
            </div>
          )}
          {emojiPicker && (
            <div className="chat-sticker-pop" data-interactive>
              <div className="emoji-picker surface" role="dialog" aria-label="Emojis">
                <input
                  className="input"
                  autoFocus
                  aria-label="Find an emoji"
                  placeholder="Find an emoji"
                  value={emojiQuery}
                  data-interactive
                  onChange={(e) => setEmojiQuery(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Escape") setEmojiPicker(false);
                  }}
                />
                <div className="emoji-grid sticker-scroll" data-interactive>
                  {pickerList.map((em) => (
                    <button
                      key={em.name}
                      type="button"
                      className="emoji-cell"
                      title={`:${em.name}:`}
                      aria-label={em.name}
                      data-interactive
                      onClick={() => {
                        setDraft((d) => `${d}${d && !d.endsWith(" ") ? " " : ""}:${em.name}: `);
                        setEmojiPicker(false);
                        setEmojiQuery("");
                        document.getElementById(inputId)?.focus();
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={em.url} alt="" loading="lazy" draggable={false} />
                    </button>
                  ))}
                  {pickerList.length === 0 && <p className="muted">No emoji called that.</p>}
                </div>
              </div>
            </div>
          )}
          <button
            type="button"
            className="icon-btn chat-sticker-btn"
            aria-label="Send a sticker"
            aria-expanded={stickers}
            title="Stickers"
            data-interactive
            data-sticker-toggle
            onClick={() => {
              setStickers((o) => !o);
              setEmojiPicker(false);
            }}
          >
            <Icon name="sticker" size={20} />
          </button>
          <button
            type="button"
            className="icon-btn chat-sticker-btn"
            aria-label="Add an emoji"
            aria-expanded={emojiPicker}
            title="Emojis (or type :name:)"
            data-interactive
            onClick={() => {
              setEmojiPicker((o) => !o);
              setStickers(false);
            }}
          >
            <Icon name="smile" size={20} />
          </button>
          <label htmlFor={inputId} className="sr-only">
            Message
          </label>
          <textarea
            id={inputId}
            rows={1}
            maxLength={2000}
            placeholder={placeholder}
            value={draft}
            autoFocus={autoFocus}
            data-interactive
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              // Tab or Enter picks the first suggested name while typing @someone.
              if ((e.key === "Tab" || e.key === "Enter") && suggestions.length) {
                e.preventDefault();
                pick(suggestions[0]);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button type="submit" className="icon-btn chat-send" aria-label="Send" disabled={!draft.trim()} data-interactive>
            <Icon name="send" size={18} />
          </button>
        </form>
      )}
    </>
  );
}
