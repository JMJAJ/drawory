"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { api } from "@/lib/client/api";
import { measuredHeights } from "@/lib/client/elements";
import { stickerSrc } from "@/lib/stickers";
import type { ElementData, ElementRow, ElementType, WinBlock, WinBlockKind } from "@/lib/types";
import { ChatThread } from "./ChatThread";
import { useBoard } from "./context";

const KINDS: { kind: WinBlockKind; label: string; icon: IconName }[] = [
  { kind: "ranking", label: "Ranking", icon: "trophy" },
  { kind: "list", label: "List", icon: "note" },
  { kind: "poll", label: "Poll", icon: "poll" },
  { kind: "chat", label: "Chat", icon: "chat" },
  { kind: "countdown", label: "Countdown", icon: "clock" },
  { kind: "text", label: "Text", icon: "text" },
  { kind: "link", label: "Link button", icon: "link" },
  { kind: "image", label: "Photo", icon: "image" },
  { kind: "divider", label: "Divider", icon: "divider" },
  { kind: "slot", label: "Empty spot", icon: "plus" },
];
const kindOf = (k: WinBlockKind) => KINDS.find((x) => x.kind === k) ?? KINDS[0];

const WIDTHS: { span: NonNullable<WinBlock["span"]>; label: string; title: string }[] = [
  { span: 2, label: "⅓", title: "A third of the width" },
  { span: 3, label: "½", title: "Half the width" },
  { span: 4, label: "⅔", title: "Two thirds of the width" },
  { span: 6, label: "Full", title: "The full width" },
];

const uid = () => crypto.randomUUID();
const item = (text: string) => ({ id: uid(), text });

/** Tomorrow at 8pm, as a starting point for countdowns. */
function tomorrowEvening() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(20, 0, 0, 0);
  return d.toISOString();
}

function newBlock(kind: WinBlockKind, over: Partial<WinBlock> = {}): WinBlock {
  const base: WinBlock = { id: uid(), kind, title: kindOf(kind).label, span: 3 };
  const extra: Partial<WinBlock> = {
    ranking: { title: "Ranking", items: [] },
    list: { title: "List", items: [] },
    poll: { title: "What do you think?", items: [item("Yes"), item("No")] },
    chat: { title: "Chat", span: 6 },
    countdown: { title: "Starts in", span: 2, at: tomorrowEvening(), align: "center", valign: "middle" },
    text: { title: "Note", text: "" },
    link: { title: "Link", span: 2, text: "Open link", url: "" },
    image: { title: "Photo", span: 2 },
    divider: { title: "", span: 6 },
    slot: { title: "", span: 2 },
  }[kind] as Partial<WinBlock>;
  return { ...base, ...extra, ...over } as WinBlock;
}

/** Puts blocks after the one they were dropped on, or in place of an empty spot. */
export function insertBlocks(blocks: readonly WinBlock[], added: WinBlock[], atId: string | null) {
  const i = atId ? blocks.findIndex((b) => b.id === atId) : -1;
  if (i < 0) return [...blocks, ...added];
  const target = blocks[i];
  if (target.kind === "slot") {
    const [first, ...rest] = added;
    return [...blocks.slice(0, i), { ...first, span: target.span, align: target.align, valign: target.valign }, ...rest, ...blocks.slice(i + 1)];
  }
  return [...blocks.slice(0, i + 1), ...added, ...blocks.slice(i + 1)];
}

/** What a board item becomes when it's dragged into a window; null if it can't go in one. */
export function blockFromElement(row: ElementRow): WinBlock | null {
  const d = row.data;
  switch (row.type) {
    case "text":
    case "sticky":
      return newBlock("text", { title: "", text: d.text ?? "" });
    case "image":
      return d.src ? newBlock("image", { title: "", src: d.src }) : null;
    case "sticker":
      return d.src ? newBlock("image", { title: "", src: stickerSrc(d.src) }) : null;
    case "note":
      return newBlock("list", { title: d.title || "List", items: (d.items ?? []).map((i) => ({ id: i.id, text: i.text, done: i.done })) });
    case "link":
      return d.url ? newBlock("link", { title: "", url: d.url, text: d.title || d.site || "Open link" }) : null;
    case "youtube":
      return d.videoId ? newBlock("link", { title: "", url: `https://youtu.be/${d.videoId}`, text: d.title || "Watch on YouTube" }) : null;
    case "chatbox":
      // Same id, so the conversation comes along.
      return newBlock("chat", { id: row.id, title: d.title || "Chat" });
    default:
      return null;
  }
}

export const MOVABLE_OUT: WinBlockKind[] = ["text", "image", "list", "link", "chat"];

/** What a block becomes when it's moved out onto the board (without its position). */
export function elementFromBlock(b: WinBlock): { id?: string; type: ElementType; data: Omit<ElementData, "x" | "y"> } | null {
  switch (b.kind) {
    case "text":
      return { type: "sticky", data: { w: 220, h: 220, text: b.text ?? "", color: "yellow" } };
    case "image":
      return b.src ? { type: "image", data: { w: 320, h: 240, src: b.src } } : null;
    case "list":
      return { type: "note", data: { w: 260, title: b.title || "List", items: (b.items ?? []).map((i) => ({ id: i.id, text: i.text, done: !!i.done })) } };
    case "link":
      return b.url ? { type: "link", data: { w: 280, url: b.url, title: b.text || b.url } } : null;
    case "chat":
      return { id: b.id, type: "chatbox", data: { w: 320, h: 400, title: b.title || "Chat" } };
    default:
      return null;
  }
}

const TEMPLATES: { id: string; label: string; hint: string; icon: IconName; title: string; blocks: () => WinBlock[] }[] = [
  {
    id: "plan",
    label: "Plan something",
    hint: "Countdown, ideas, list and chat",
    icon: "clock",
    title: "Plans",
    blocks: () => [
      newBlock("ranking", { title: "What should we do?", span: 4, items: [item("Movie night"), item("Board games")] }),
      newBlock("countdown"),
      newBlock("list", { title: "Bring", span: 2, items: [item("Snacks")] }),
      newBlock("chat", { span: 4 }),
    ],
  },
  {
    id: "tier",
    label: "Ranking",
    hint: "Vote things up to the top",
    icon: "trophy",
    title: "Best of",
    blocks: () => [newBlock("ranking", { title: "Vote your favourites", span: 6 })],
  },
  {
    id: "board",
    label: "Mood board",
    hint: "Empty spots to drag things into",
    icon: "image",
    title: "Mood board",
    blocks: () => [newBlock("slot", { span: 4 }), newBlock("slot"), newBlock("slot"), newBlock("slot"), newBlock("slot")],
  },
  {
    id: "poll",
    label: "Poll and chat",
    hint: "Ask, vote, talk it over",
    icon: "poll",
    title: "Quick poll",
    blocks: () => [newBlock("poll"), newBlock("chat", { span: 3 })],
  },
];

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Turns "example.com" into a link that opens; anything that isn't http(s) is refused. */
function safeUrl(raw: string | undefined) {
  const v = (raw ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Uploads a photo to the room's storage; returns its address, or null if it failed. */
function useUpload() {
  const { boardId } = useBoard();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("That isn't a photo.");
      return null;
    }
    setBusy(true);
    setError(null);
    try {
      return (await api.upload(boardId, file, file.name)).url;
    } catch {
      setError("That photo didn't upload. Try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

/** A small "attach a picture" button for one ranking or list item. */
function ItemPhoto({ has, onPicked }: { has: boolean; onPicked: (src: string) => void }) {
  const up = useUpload();
  const label = has ? "Replace the picture" : "Add a picture";
  return (
    <label className={`win-x win-item-photo${up.busy ? " busy" : ""}`} title={up.error ?? label} aria-label={label}>
      <Icon name="image" size={14} />
      <input
        type="file"
        accept="image/*"
        hidden
        data-interactive
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          const src = file ? await up.run(file) : null;
          if (src) onPicked(src);
        }}
      />
    </label>
  );
}

function Thumb({ src, alt }: { src?: string; alt: string }) {
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="win-thumb" src={src} alt={alt} draggable={false} />;
}

type Update = (change: Partial<WinBlock> | ((b: WinBlock) => Partial<WinBlock>)) => void;

/** A window: a card on the board built from blocks (ranking, list, chat…). It grows to fit them. */
export function WindowView({ row, editing }: { row: ElementRow; editing: boolean }) {
  const ctx = useBoard();
  const d = row.data;
  const blocks = d.blocks ?? [];
  const [selId, setSelId] = useState<string | null>(null);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const dragId = useRef<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const selected = editing ? blocks.find((b) => b.id === selId) ?? null : null;
  // Changes start from the newest blocks, even ones made a moment ago and not yet rendered
  // (two photos finishing their upload together must not undo each other).
  const latest = useRef(blocks);
  useLayoutEffect(() => {
    latest.current = blocks;
  }, [blocks]);
  const current = () => latest.current;
  // While using a window, a block that doesn't fit beside the next one stretches to fill its row,
  // so there are no holes. Edit mode shows the real widths so you can arrange them.
  const spans = new Map<string, number>();
  {
    let used = 0;
    let prev: string | null = null;
    for (const blk of blocks) {
      const want = blk.kind === "divider" ? 6 : blk.span ?? 3;
      if (used + want > 6) {
        if (prev && !editing) spans.set(prev, (spans.get(prev) ?? 0) + 6 - used);
        used = 0;
      }
      spans.set(blk.id, want);
      used += want;
      prev = blk.id;
    }
    if (prev && !editing && used < 6) spans.set(prev, (spans.get(prev) ?? 0) + 6 - used);
  }

  // The window's height comes from its blocks; remember it so selection boxes fit.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => measuredHeights.set(row.id, el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [row.id]);

  const setBlocks = (next: WinBlock[]) => {
    latest.current = next;
    ctx.patch(row.id, { blocks: next });
  };
  const updater =
    (id: string): Update =>
    (change) =>
      setBlocks(current().map((b) => (b.id === id ? { ...b, ...(typeof change === "function" ? change(b) : change) } : b)));

  function move(id: string, by: number) {
    const i = current().findIndex((b) => b.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= current().length) return;
    const next = [...current()];
    [next[i], next[j]] = [next[j], next[i]];
    setBlocks(next);
  }
  function dropBefore(targetId: string) {
    const from = dragId.current;
    dragId.current = null;
    setDropOn(null);
    if (!from || from === targetId) return;
    const moving = current().find((b) => b.id === from);
    if (!moving) return;
    const rest = current().filter((b) => b.id !== from);
    const at = rest.findIndex((b) => b.id === targetId);
    rest.splice(at < 0 ? rest.length : at, 0, moving);
    setBlocks(rest);
  }
  function add(kind: WinBlockKind) {
    const b = newBlock(kind);
    setBlocks([...current(), b]);
    setSelId(b.id);
  }
  function remove(id: string) {
    const i = current().findIndex((b) => b.id === id);
    const next = current().filter((b) => b.id !== id);
    setBlocks(next);
    setSelId(next[Math.min(i, next.length - 1)]?.id ?? null);
  }

  const canEdit = !ctx.readOnly;
  const dropUpload = useUpload();
  const [fileOver, setFileOver] = useState(false);

  /** Photos dropped on a window being edited become photo blocks, next to the block they land on. */
  async function dropPhotos(files: File[], afterId: string | null) {
    const srcs: string[] = [];
    for (const f of files.filter((f) => f.type.startsWith("image/")).slice(0, 6)) {
      const src = await dropUpload.run(f);
      if (src) srcs.push(src);
    }
    if (!srcs.length) return;
    const added = srcs.map((src) => newBlock("image", { src, title: "" }));
    setBlocks(insertBlocks(current(), added, afterId));
    setSelId(added[0].id);
  }

  return (
    <div
      ref={root}
      className={`card win${editing ? " editing" : ""}${d.h ? " fixed" : ""}${fileOver ? " file-over" : ""}`}
      onDragOver={(e) => {
        if (!canEdit || !e.dataTransfer.types.includes("Files")) return;
        if (!editing && !(e.target as HTMLElement).closest(".kind-slot")) return setFileOver(false);
        e.preventDefault();
        e.stopPropagation();
        setFileOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFileOver(false);
      }}
      onDrop={(e) => {
        if (!canEdit || !e.dataTransfer.files.length) return;
        if (!editing && !(e.target as HTMLElement).closest(".kind-slot")) return;
        e.preventDefault();
        e.stopPropagation();
        setFileOver(false);
        const onBlock = (e.target as HTMLElement).closest<HTMLElement>("[data-block]")?.dataset.block ?? null;
        void dropPhotos([...e.dataTransfer.files], onBlock);
      }}
    >
      <div className="win-head">
        <span className="win-icon" aria-hidden="true">
          <Icon name="window" size={20} />
        </span>
        <div className="win-titles">
          {editing ? (
            <>
              <input
                className="win-title-input"
                aria-label="Window title"
                defaultValue={d.title}
                placeholder="Window title"
                maxLength={60}
                data-interactive
                onBlur={(e) => e.target.value.trim() !== (d.title ?? "") && ctx.patch(row.id, { title: e.target.value.trim() || "Window" })}
                onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && e.currentTarget.blur()}
              />
              <input
                className="win-sub-input"
                aria-label="Subtitle"
                defaultValue={d.subtitle}
                placeholder="Add a subtitle"
                maxLength={80}
                data-interactive
                onBlur={(e) => e.target.value.trim() !== (d.subtitle ?? "") && ctx.patch(row.id, { subtitle: e.target.value.trim() })}
                onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && e.currentTarget.blur()}
              />
            </>
          ) : (
            <>
              <div className="win-title">{d.title || "Window"}</div>
              {d.subtitle && <div className="win-sub">{d.subtitle}</div>}
            </>
          )}
        </div>
        {editing && d.h ? (
          <button type="button" className="btn btn-ghost win-fit" data-interactive title="Size the window to its blocks again" onClick={() => ctx.patch(row.id, { h: undefined })}>
            Fit height
          </button>
        ) : null}
        {canEdit && (
          <button
            type="button"
            className="btn win-edit"
            data-interactive
            aria-pressed={editing}
            onClick={() => (editing ? ctx.stopEditing() : ctx.startEditing(row.id))}
          >
            <Icon name={editing ? "check" : "pen"} size={16} />
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </div>

      {editing && (
        <div className="win-tools" role="toolbar" aria-label="Arrange block">
          {selected ? (
            <>
              <span className="win-tools-label">{selected.title || kindOf(selected.kind).label}</span>
              <span className="win-sep" />
              {selected.kind !== "divider" &&
                WIDTHS.map((w) => (
                  <button
                    key={w.span}
                    type="button"
                    className="win-tb"
                    title={w.title}
                    aria-pressed={(selected.span ?? 3) === w.span}
                    onClick={() => updater(selected.id)({ span: w.span })}
                  >
                    {w.label}
                  </button>
                ))}
              {selected.kind !== "divider" && selected.kind !== "chat" && (
                <>
                  <span className="win-sep" />
                  {(["left", "center", "right"] as const).map((a) => (
                    <button
                      key={a}
                      type="button"
                      className="win-tb"
                      aria-label={`Align ${a}`}
                      title={`Align ${a}`}
                      aria-pressed={(selected.align ?? "left") === a}
                      onClick={() => updater(selected.id)({ align: a })}
                    >
                      <Icon name={a === "left" ? "textLeft" : a === "center" ? "textCenter" : "textRight"} size={17} />
                    </button>
                  ))}
                  <span className="win-sep" />
                  {(["top", "middle", "bottom"] as const).map((a) => (
                    <button
                      key={a}
                      type="button"
                      className="win-tb"
                      aria-label={`Align ${a}`}
                      title={`Align to the ${a}`}
                      aria-pressed={(selected.valign ?? "top") === a}
                      onClick={() => updater(selected.id)({ valign: a })}
                    >
                      <Icon name={a === "top" ? "alignTop" : a === "middle" ? "alignMiddle" : "alignBottom"} size={17} />
                    </button>
                  ))}
                </>
              )}
              <span className="win-sep" />
              <button type="button" className="win-tb" aria-label="Move earlier" title="Move earlier" onClick={() => move(selected.id, -1)}>
                <Icon name="arrowLeft" size={17} />
              </button>
              <button type="button" className="win-tb" aria-label="Move later" title="Move later" onClick={() => move(selected.id, 1)}>
                <Icon name="arrowRight" size={17} />
              </button>
              {MOVABLE_OUT.includes(selected.kind) && (
                <button
                  type="button"
                  className="win-tb"
                  aria-label="Move out onto the board"
                  title="Move out onto the board"
                  onClick={() => {
                    setSelId(null);
                    ctx.moveBlockOut(row.id, selected.id);
                  }}
                >
                  <Icon name="external" size={17} />
                </button>
              )}
              <button type="button" className="win-tb danger" aria-label="Remove block" title="Remove block" onClick={() => remove(selected.id)}>
                <Icon name="trash" size={17} />
              </button>
            </>
          ) : (
            <span className="win-tools-hint">{blocks.length ? "Select a block to size and align it, or drag it by its handle" : "Add your first block below"}</span>
          )}
        </div>
      )}

      {blocks.length > 0 && (
        <div className="win-body">
          <div className="win-grid">
            {blocks.map((b) => {
              const isClosed = closed.has(b.id) && !editing;
              const k = kindOf(b.kind);
              return (
                <section
                  key={b.id}
                  data-block={b.id}
                  className={`win-blk kind-${b.kind}${selected?.id === b.id ? " sel" : ""}${dropOn === b.id ? " drop" : ""}`}
                  style={{ gridColumn: `span ${spans.get(b.id) ?? 3}` }}
                  aria-label={b.title || k.label}
                  draggable={editing}
                  onClick={editing ? () => setSelId(b.id) : undefined}
                  onDragStart={(e) => {
                    dragId.current = b.id;
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/x-drawory-block", b.id);
                    e.stopPropagation();
                  }}
                  onDragOver={(e) => {
                    if (!dragId.current) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setDropOn(b.id);
                  }}
                  onDragLeave={() => setDropOn((cur) => (cur === b.id ? null : cur))}
                  onDrop={(e) => {
                    if (!dragId.current) return;
                    e.preventDefault();
                    e.stopPropagation();
                    dropBefore(b.id);
                  }}
                  onDragEnd={() => {
                    dragId.current = null;
                    setDropOn(null);
                  }}
                >
                  {b.kind === "divider" ? (
                    editing ? <div className="win-divider-edit">Divider</div> : <hr className="win-hr" />
                  ) : (
                    <>
                      {(editing || b.title !== "") && (
                      <header className="win-bh">
                        {editing && (
                          <span className="win-grip" title="Drag to reorder">
                            <Icon name="grip" size={16} />
                          </span>
                        )}
                        <Icon name={k.icon} size={17} className="win-bicon" />
                        {editing ? (
                          <input
                            key={b.title}
                            className="win-bt-input"
                            aria-label="Block title"
                            defaultValue={b.title}
                            placeholder={k.label}
                            maxLength={60}
                            data-interactive
                            onFocus={() => setSelId(b.id)}
                            onBlur={(e) => e.target.value.trim() !== (b.title ?? "") && updater(b.id)({ title: e.target.value.trim() })}
                            onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && e.currentTarget.blur()}
                          />
                        ) : (
                          <span className="win-bt">{b.title || k.label}</span>
                        )}
                        {!editing && (
                          <button
                            type="button"
                            className="win-collapse"
                            data-interactive
                            aria-expanded={!isClosed}
                            aria-label={isClosed ? `Show ${b.title || k.label}` : `Hide ${b.title || k.label}`}
                            onClick={() =>
                              setClosed((s) => {
                                const n = new Set(s);
                                if (n.has(b.id)) n.delete(b.id);
                                else n.add(b.id);
                                return n;
                              })
                            }
                          >
                            <Icon name={isClosed ? "chevronDown" : "chevronUp"} size={16} />
                          </button>
                        )}
                      </header>
                      )}
                      {!isClosed && (
                        <div className={`win-bb a-${b.align ?? "left"} v-${b.valign ?? "top"}`}>
                          <BlockBody block={b} editing={editing} update={updater(b.id)} />
                        </div>
                      )}
                    </>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}

      {blocks.length === 0 && canEdit && (
        <div className="win-empty">
          <div className="win-empty-label">Start from a template</div>
          <div className="win-templates">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="win-template"
                data-interactive
                onClick={() => ctx.patch(row.id, { blocks: t.blocks(), title: d.title && d.title !== "Window" ? d.title : t.title })}
              >
                <Icon name={t.icon} size={18} />
                <span>
                  <strong>{t.label}</strong>
                  <span className="muted">{t.hint}</span>
                </span>
              </button>
            ))}
          </div>
          {!editing && (
            <button type="button" className="btn btn-ghost win-blank" data-interactive onClick={() => ctx.startEditing(row.id)}>
              Or build your own
            </button>
          )}
        </div>
      )}

      {editing && (
        <div className="win-add">
          <div className="win-add-label">
            {dropUpload.busy ? "Uploading your photo…" : dropUpload.error ?? "Add a block, or drop photos here. The window grows to fit."}
          </div>
          <div className="win-chips">
            {KINDS.map((k) => (
              <button key={k.kind} type="button" className="win-chip" onClick={() => add(k.kind)}>
                <Icon name={k.icon} size={15} />
                {k.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BlockBody({ block, editing, update }: { block: WinBlock; editing: boolean; update: Update }) {
  switch (block.kind) {
    case "ranking":
      return <RankingBlock block={block} editing={editing} update={update} />;
    case "poll":
      return <PollBlock block={block} editing={editing} update={update} />;
    case "list":
      return <ListBlock block={block} editing={editing} update={update} />;
    case "chat":
      return <ChatBlock block={block} />;
    case "countdown":
      return <CountdownBlock block={block} editing={editing} update={update} />;
    case "text":
      return <TextBlock block={block} editing={editing} update={update} />;
    case "link":
      return <LinkBlock block={block} editing={editing} update={update} />;
    case "image":
      return <ImageBlock block={block} editing={editing} update={update} />;
    case "slot":
      return (
        <div className="win-slot">
          <Icon name="plus" size={20} />
          <span>Drag text, a photo, a note or a chat here</span>
        </div>
      );
    default:
      return null;
  }
}

/** A one-line box for adding an option or item. */
function AddItem({ placeholder, onAdd }: { placeholder: string; onAdd: (text: string) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <form
      className="win-additem"
      onSubmit={(e) => {
        e.preventDefault();
        const t = draft.trim();
        if (!t) return;
        onAdd(t.slice(0, 120));
        setDraft("");
      }}
    >
      <Icon name="plus" size={15} />
      <input aria-label={placeholder} placeholder={placeholder} value={draft} data-interactive onChange={(e) => setDraft(e.target.value)} />
    </form>
  );
}

function toggleVote(votes: Record<string, string[]> | undefined, optionId: string, me: string, single: boolean) {
  const v: Record<string, string[]> = {};
  const had = (votes?.[optionId] ?? []).includes(me);
  for (const [k, list] of Object.entries(votes ?? {})) v[k] = single || k === optionId ? list.filter((u) => u !== me) : list;
  if (!had) v[optionId] = [...(v[optionId] ?? []), me];
  return v;
}

function RankingBlock({ block, editing, update }: { block: WinBlock; editing: boolean; update: Update }) {
  const { me, readOnly } = useBoard();
  const items = (block.items ?? []).map((it) => {
    const voters = block.votes?.[it.id] ?? [];
    return { it, n: voters.length, mine: voters.includes(me.id) };
  });
  // Most votes first; ties keep the order they were added in.
  const sorted = items.map((x, i) => ({ ...x, i })).sort((a, b) => b.n - a.n || a.i - b.i);
  const max = Math.max(1, ...sorted.map((x) => x.n));
  return (
    <>
      {sorted.length === 0 && <p className="win-hint">Add options, then everyone votes them up.</p>}
      <ol className="win-rank">
        {sorted.map(({ it, n, mine }, i) => (
          <li key={it.id} className={i === 0 && n > 0 ? "top" : undefined}>
            <span className="win-rank-n">{i + 1}</span>
            <Thumb src={it.src} alt={it.text} />
            <div className="win-rank-main">
              <span className="win-rank-text">{it.text}</span>
              <div className="win-bar">
                <div style={{ width: `${(n / max) * 100}%` }} />
              </div>
            </div>
            {editing ? (
              <>
                <ItemPhoto has={!!it.src} onPicked={(src) => update((b) => ({ items: (b.items ?? []).map((x) => (x.id === it.id ? { ...x, src } : x)) }))} />
                <button
                  type="button"
                  className="win-x"
                  aria-label={`Remove ${it.text}`}
                  onClick={() => update((b) => ({ items: (b.items ?? []).filter((x) => x.id !== it.id) }))}
                >
                  <Icon name="close" size={14} />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="win-vote"
                data-interactive
                aria-pressed={mine}
                disabled={readOnly}
                aria-label={`${mine ? "Remove your vote for" : "Vote for"} ${it.text} (${n})`}
                onClick={() => update((b) => ({ votes: toggleVote(b.votes, it.id, me.id, false) }))}
              >
                <Icon name="vote" size={14} />
                {n}
              </button>
            )}
          </li>
        ))}
      </ol>
      {!readOnly && <AddItem placeholder="Add an option" onAdd={(text) => update((b) => ({ items: [...(b.items ?? []), item(text)] }))} />}
    </>
  );
}

function PollBlock({ block, editing, update }: { block: WinBlock; editing: boolean; update: Update }) {
  const { me, readOnly } = useBoard();
  const options = block.items ?? [];
  const total = options.reduce((s, o) => s + (block.votes?.[o.id]?.length ?? 0), 0);
  return (
    <>
      <div className="win-poll" role="group" aria-label={block.title}>
        {options.map((o) => {
          const n = block.votes?.[o.id]?.length ?? 0;
          const mine = (block.votes?.[o.id] ?? []).includes(me.id);
          const pct = total ? Math.round((n / total) * 100) : 0;
          return (
            <div key={o.id} className="win-poll-row">
              <button
                type="button"
                className="win-poll-opt"
                data-interactive
                aria-pressed={mine}
                disabled={readOnly || editing}
                onClick={() => update((b) => ({ votes: toggleVote(b.votes, o.id, me.id, true) }))}
              >
                <span className="win-poll-fill" style={{ width: `${pct}%` }} />
                <span className="win-poll-text">{o.text}</span>
                <span className="win-poll-pct">{total ? `${pct}%` : ""}</span>
              </button>
              {editing && (
                <button
                  type="button"
                  className="win-x"
                  aria-label={`Remove ${o.text}`}
                  onClick={() => update((b) => ({ items: (b.items ?? []).filter((x) => x.id !== o.id) }))}
                >
                  <Icon name="close" size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="win-meta">{total === 1 ? "1 vote" : `${total} votes`} · one choice each</div>
      {editing && <AddItem placeholder="Add a choice" onAdd={(text) => update((b) => ({ items: [...(b.items ?? []), item(text)] }))} />}
    </>
  );
}

function ListBlock({ block, editing, update }: { block: WinBlock; editing: boolean; update: Update }) {
  const { readOnly } = useBoard();
  const items = block.items ?? [];
  return (
    <>
      {items.length === 0 && <p className="win-hint">Nothing here yet. Add the first thing.</p>}
      <ul className="win-list">
        {items.map((it) => (
          <li key={it.id} className={it.done ? "done" : undefined}>
            <button
              type="button"
              className="check-box"
              data-interactive
              disabled={readOnly}
              aria-pressed={!!it.done}
              aria-label={`${it.done ? "Uncheck" : "Check"} ${it.text}`}
              onClick={() => update((b) => ({ items: (b.items ?? []).map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)) }))}
            >
              {it.done && <Icon name="check" size={13} strokeWidth={3.5} />}
            </button>
            <Thumb src={it.src} alt={it.text} />
            <span className="win-list-text">{it.text}</span>
            {editing && (
              <ItemPhoto has={!!it.src} onPicked={(src) => update((b) => ({ items: (b.items ?? []).map((x) => (x.id === it.id ? { ...x, src } : x)) }))} />
            )}
            {editing && (
              <button
                type="button"
                className="win-x"
                aria-label={`Remove ${it.text}`}
                onClick={() => update((b) => ({ items: (b.items ?? []).filter((x) => x.id !== it.id) }))}
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!readOnly && <AddItem placeholder="Add an item" onAdd={(text) => update((b) => ({ items: [...(b.items ?? []), { ...item(text), done: false }] }))} />}
    </>
  );
}

function ChatBlock({ block }: { block: WinBlock }) {
  const ctx = useBoard();
  return (
    <div className="chatbox win-chat">
      <ChatThread
        messages={ctx.chatFor(block.id)}
        me={ctx.me}
        readOnly={ctx.readOnly}
        onSend={(body) => ctx.sendChat(block.id, body)}
        inputId={`win-chat-${block.id}`}
        placeholder="Message"
      />
    </div>
  );
}

/** "2d 4h", "35m 10s" until the time; how long ago once it's passed. */
function untilText(ms: number) {
  const s = Math.round(Math.abs(ms) / 1000);
  const dd = Math.floor(s / 86400);
  const hh = Math.floor((s % 86400) / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (dd > 0) return `${dd}d ${hh}h`;
  if (hh > 0) return `${hh}h ${mm}m`;
  return `${mm}m ${ss}s`;
}

function localInputValue(iso: string | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CountdownBlock({ block, editing, update }: { block: WinBlock; editing: boolean; update: Update }) {
  const now = useNow(1000);
  const at = block.at ? new Date(block.at).getTime() : NaN;
  if (editing) {
    return (
      <input
        type="datetime-local"
        className="win-input"
        aria-label="Count down to"
        defaultValue={localInputValue(block.at)}
        data-interactive
        onChange={(e) => {
          const d = new Date(e.target.value);
          if (!Number.isNaN(d.getTime())) update({ at: d.toISOString() });
        }}
      />
    );
  }
  if (Number.isNaN(at)) return <p className="win-hint">Pick a time in edit mode.</p>;
  const left = at - now;
  const when = new Date(at).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return (
    <>
      <div className="win-count">{left > 0 ? untilText(left) : "It's time"}</div>
      <div className="win-meta">{left > 0 ? when : `${untilText(left)} ago · ${when}`}</div>
    </>
  );
}

function TextBlock({ block, editing, update }: { block: WinBlock; editing: boolean; update: Update }) {
  if (editing) {
    return (
      <textarea
        className="win-input win-textarea"
        aria-label="Text"
        defaultValue={block.text}
        placeholder="Write something…"
        maxLength={2000}
        rows={3}
        data-interactive
        onBlur={(e) => e.target.value !== (block.text ?? "") && update({ text: e.target.value })}
      />
    );
  }
  return block.text ? <p className="win-text">{block.text}</p> : <p className="win-hint">Empty text. Write in it from edit mode.</p>;
}

function LinkBlock({ block, editing, update }: { block: WinBlock; editing: boolean; update: Update }) {
  if (editing) {
    return (
      <>
        <input
          className="win-input"
          aria-label="Button label"
          defaultValue={block.text}
          placeholder="Button label"
          maxLength={40}
          data-interactive
          onBlur={(e) => e.target.value.trim() !== (block.text ?? "") && update({ text: e.target.value.trim() })}
        />
        <input
          className="win-input"
          aria-label="Link address"
          defaultValue={block.url}
          placeholder="https://example.com"
          maxLength={500}
          data-interactive
          onBlur={(e) => e.target.value.trim() !== (block.url ?? "") && update({ url: e.target.value.trim() })}
        />
      </>
    );
  }
  const href = safeUrl(block.url);
  if (!href) return <p className="win-hint">Add a link in edit mode.</p>;
  return (
    <a className="btn btn-primary win-link" href={href} target="_blank" rel="noopener noreferrer" data-interactive>
      <Icon name="external" size={16} />
      {block.text || "Open link"}
    </a>
  );
}

function ImageBlock({ block, editing, update }: { block: WinBlock; editing: boolean; update: Update }) {
  const up = useUpload();
  return (
    <>
      {block.src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="win-img" src={block.src} alt={block.title || "Photo"} draggable={false} />
      ) : (
        <div className="win-img-empty">
          <Icon name="image" size={24} />
          <span>{editing ? "Choose a photo, or drop one on the window" : "No photo yet"}</span>
        </div>
      )}
      {editing && (
        <label className="btn win-upload">
          <Icon name="upload" size={16} />
          {up.busy ? "Uploading…" : block.src ? "Replace photo" : "Choose photo"}
          <input
            type="file"
            accept="image/*"
            hidden
            data-interactive
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              const src = file ? await up.run(file) : null;
              if (src) update({ src });
            }}
          />
        </label>
      )}
      {up.error && <p className="win-error">{up.error}</p>}
    </>
  );
}
