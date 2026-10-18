"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { api, ApiError } from "@/lib/client/api";
import {
  bounds,
  cameraFor,
  clampZoom,
  contains,
  makeRow,
  newId,
  normalizePoints,
  RESIZABLE,
  snapBox,
  STROKE_COLORS,
  STROKE_SIZES,
  STYLABLE,
  FONTS,
  unionBounds,
  type Camera,
  type SnapGuide,
} from "@/lib/client/elements";
import { displayCode, inviteLink, rememberRoom } from "@/lib/client/rooms";
import { initials, textOn, type Me } from "@/lib/client/identity";
import { audioPeaks, detectLink, fitWithin, imageSize, shrinkPhoto, videoSize, type DetectedLink } from "@/lib/client/media";
import type { Activity, BoardMeta, BoardPage, ChatRow, ElementData, ElementRow, ElementType, PresenceRow, WinBlock } from "@/lib/types";
import { PagesBar } from "./PagesBar";
import { NowPlaying, type PlayingItem } from "./NowPlaying";
import { BoardContext, type BoardCtx, type YtCommand } from "./context";
import {
  AddMediaDialog,
  CapsuleDialog,
  CapsuleNoteDialog,
  CapsuleOpenDialog,
  PlaceDialog,
  SetupDialog,
  VoiceDialog,
} from "./Dialogs";
import { ElementView, StrokeSvg, type RemoteMark } from "./ElementView";
import { blockFromElement, elementFromBlock, insertBlocks } from "./WindowView";
import { RemoteCursor } from "./RemoteCursor";
import { MemoryLane } from "./MemoryLane";
import { StickerTray } from "./StickerTray";
import { ZoomControl } from "./ZoomControl";
import { TextSizeControl } from "./TextSizeControl";
import { useBoardSync, type SyncStatus } from "./sync";
import { useRoomSocket } from "./socket";
import type { Sticker } from "@/lib/stickers";

type Tool =
  | "hand" | "select" | "pen" | "eraser" | "rect" | "ellipse" | "arrow" | "text"
  | "note" | "sticky" | "sticker" | "chatbox" | "window" | "media" | "youtube" | "voice" | "capsule";

type Change = { before: ElementRow | null; after: ElementRow | null };

type Gesture =
  // hold: on touch, keeping a finger still on empty canvas turns the pan into a selection box.
  | { kind: "pan"; sx: number; sy: number; cam: Camera; hold?: ReturnType<typeof setTimeout> }
  | { kind: "pinch"; d0: number; mx: number; my: number; cam: Camera }
  | { kind: "draw"; points: number[][] }
  | { kind: "shape"; type: "rect" | "ellipse" | "arrow"; ox: number; oy: number }
  | { kind: "move"; wx: number; wy: number; originals: ElementRow[]; moved: boolean; canDrop: boolean; into?: DropInto | null }
  | { kind: "resize"; wx: number; wy: number; original: ElementRow }
  | { kind: "erase"; originals: Map<string, ElementRow> }
  | { kind: "marquee"; wx: number; wy: number; base: string[] };

const TOOL_GROUPS: { id: Tool; label: string; icon: IconName; key?: string }[][] = [
  [
    { id: "hand", label: "Pan", icon: "hand", key: "h" },
    { id: "select", label: "Select", icon: "select", key: "v" },
  ],
  [
    { id: "pen", label: "Draw", icon: "pen", key: "p" },
    { id: "eraser", label: "Eraser", icon: "eraser", key: "e" },
    { id: "rect", label: "Rectangle", icon: "rect", key: "r" },
    { id: "ellipse", label: "Ellipse", icon: "ellipse", key: "o" },
    { id: "arrow", label: "Arrow", icon: "arrow", key: "a" },
    { id: "text", label: "Text", icon: "text", key: "t" },
  ],
  [
    { id: "sticky", label: "Sticky note", icon: "stickynote", key: "y" },
    { id: "note", label: "Checklist", icon: "note", key: "n" },
    { id: "sticker", label: "Stickers", icon: "sticker", key: "s" },
    { id: "chatbox", label: "Chat box", icon: "chat", key: "c" },
    { id: "window", label: "Window: ranking, lists, chat and more", icon: "window", key: "w" },
    { id: "media", label: "Photo, video or link", icon: "image" },
    { id: "youtube", label: "Watch together", icon: "youtube" },
    { id: "voice", label: "Voice note", icon: "mic" },
    { id: "capsule", label: "Time capsule", icon: "capsule" },
  ],
];
/** A window (and the block in it) that dragged items will drop into. */
type DropInto = { winId: string; blockId: string | null };

type AlignKind = "left" | "center" | "right" | "top" | "middle" | "bottom" | "across" | "down";
const ALIGN_ACTIONS: { id: AlignKind; label: string; icon: IconName; group: number; spread?: boolean }[] = [
  { id: "left", label: "Align left edges", icon: "alignLeft", group: 0 },
  { id: "center", label: "Align centres", icon: "alignCenter", group: 0 },
  { id: "right", label: "Align right edges", icon: "alignRight", group: 0 },
  { id: "top", label: "Align top edges", icon: "alignTop", group: 1 },
  { id: "middle", label: "Align middles", icon: "alignMiddle", group: 1 },
  { id: "bottom", label: "Align bottom edges", icon: "alignBottom", group: 1 },
  { id: "across", label: "Space evenly across", icon: "spreadAcross", group: 2, spread: true },
  { id: "down", label: "Space evenly down", icon: "spreadDown", group: 2, spread: true },
];
const KEY_TOOLS = Object.fromEntries(TOOL_GROUPS.flat().filter((t) => t.key).map((t) => [t.key!, t.id]));
const DRAW_TOOLS: Tool[] = ["pen", "rect", "ellipse", "arrow", "text"];
const TEXT_SIZES = [20, 28, 44];
const SHAPE_WIDTHS = [2, 3.5, 6];
const ONLINE_MS = 45_000;
const DOUBLE_TAP_MS = 350;
const HOLD_TO_SELECT_MS = 450;
const STATUS: Record<SyncStatus, { label: string; title: string }> = {
  live: { label: "Live", title: "Everyone's changes and cursors appear instantly" },
  polling: { label: "Synced", title: "The instant connection isn't available here, so the board syncs every second. Tap to retry." },
  connecting: { label: "Connecting…", title: "Connecting to the board" },
  offline: { label: "Offline", title: "Can't reach the board right now. Tap to retry." },
};

const DEFAULT_PAGES: BoardPage[] = [{ id: "main", name: "Page 1" }];
const pageOf = (r: { data: ElementData }) => r.data.page ?? "main";
const NO_CHAT: readonly ChatRow[] = [];
/** Types you can open for editing (double-click, double-tap or the pen button). */
const EDITABLE: ElementType[] = ["text", "note", "image", "chatbox", "sticky", "window"];

function isEditable(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

/**
 * Retries a save through a flaky connection (a phone switching networks, a server restart).
 * Changes stay on screen meanwhile. Requests the server rejected (4xx) aren't retried.
 */
async function withRetry<T>(fn: () => Promise<T>) {
  for (const wait of [1_000, 2_000, 4_000, 8_000, 15_000]) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) throw e;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  return fn();
}

/**
 * Next animation frame, or a short timer if frames don't come (a tab the browser isn't drawing,
 * some embedded browsers), so an animation always finishes instead of freezing halfway.
 */
function nextFrame(fn: (t: number) => void) {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    fn(performance.now());
  };
  const raf = requestAnimationFrame(run);
  const timer = setTimeout(run, 50);
}

function relativeTime(date: Date, now: number) {
  const s = (now - date.getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function Board({ boardId, me, onChangeMe }: { boardId: string; me: Me; onChangeMe: (me: Me) => void }) {
  /* ---------- Live data ---------- */
  const sync = useBoardSync(boardId);
  const elData = sync.elements;
  const awaitTxId = sync.awaitTxId;

  // Optimistic overlay: local changes show instantly and drop once the live query confirms them.
  const [overlay, setOverlay] = useState(() => new Map<string, { row: ElementRow | null; v: number }>());
  const versionCounter = useRef(0);

  // The room's pages, and which one I'm on (remembered per room on this device).
  const [board, setBoard] = useState<BoardMeta | null>(null);
  const pages = board?.pages?.length ? board.pages : DEFAULT_PAGES;
  const pageKey = `drawory:page:${boardId}`;
  const [pageChoice, setPageChoice] = useState<string>(() => {
    try {
      return localStorage.getItem(pageKey) || "main";
    } catch {
      return "main";
    }
  });
  // If someone deleted the page I was on, land on the first one.
  const page = pages.some((p) => p.id === pageChoice) ? pageChoice : pages[0].id;
  const pageRef = useRef(page);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  const committed = useMemo(() => new Map((elData ?? []).map((r) => [r.id, r])), [elData]);
  const rows = useMemo(() => {
    const map = new Map(committed);
    for (const [id, o] of overlay) {
      if (o.row) map.set(id, o.row);
      else map.delete(id);
    }
    return [...map.values()].filter((r) => pageOf(r) === page).sort((a, b) => a.z - b.z);
  }, [committed, overlay, page]);
  const rowsById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const rowsRef = useRef(rowsById);
  const committedRef = useRef(committed);
  useEffect(() => {
    rowsRef.current = rowsById;
    committedRef.current = committed;
  }, [rowsById, committed]);

  /* ---------- UI state ---------- */
  const rootRef = useRef<HTMLDivElement>(null);
  const [camera, setCameraState] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const cam = useRef(camera);
  const setCamera = useCallback((c: Camera) => {
    cam.current = c;
    setCameraState(c);
  }, []);
  const [cameraReady, setCameraReady] = useState(false);
  // Phones and tablets start on Select, so one finger moves around the board instead of drawing.
  const [tool, setTool] = useState<Tool>(() => (matchMedia("(pointer: coarse)").matches && !matchMedia("(pointer: fine)").matches ? "select" : "pen"));
  const [colorId, setColorId] = useState("ink");
  const [sizeId, setSizeId] = useState(2);
  const [fontId, setFontId] = useState<string>("clean");
  const [textSize, setTextSize] = useState(28);
  // New sticky notes use the color of the last one you picked.
  const [stickyColor, setStickyColor] = useState("yellow");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  // Single-item helpers; the toolbar, editing and resizing work on one item.
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const setSelectedId = useCallback((id: string | null) => setSelectedIds(id ? [id] : []), []);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [editingId, setEditingIdState] = useState<string | null>(null);
  // Mirrors editingId synchronously, so a finished edit can't be saved twice.
  const editingRef = useRef<string | null>(null);
  const setEditingId = useCallback((id: string | null) => {
    editingRef.current = id;
    setEditingIdState(id);
  }, []);
  const [draft, setDraftState] = useState<ElementRow | null>(null);
  const draftRef = useRef<ElementRow | null>(null);
  const setDraft = useCallback((d: ElementRow | null) => {
    draftRef.current = d;
    setDraftState(d);
  }, []);
  const [dialog, setDialog] = useState<
    | null
    | { kind: "media"; url?: string }
    | { kind: "voice" }
    | { kind: "capsule" }
    | { kind: "capsuleNote"; id: string }
    | { kind: "capsuleOpen"; id: string; title: string }
    | { kind: "place" }
    | { kind: "me" }
  >(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [stickersOpen, setStickersOpen] = useState(false);
  // Lines shown while a dragged item snaps to others.
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  // The align menu belongs to one selection; picking something else closes it.
  const [alignFor, setAlignFor] = useState<string | null>(null);
  const [toast, setToast] = useState<{ id: number; text: string; heart?: boolean; action?: { label: string; run: () => void } } | null>(null);
  const [hearts, setHearts] = useState<{ id: number; x: number; y: number; dx: number; delay: number }[]>([]);
  const [followId, setFollowId] = useState<string | null>(null);
  const setFollowing = (on: boolean) => !on && setFollowId(null);
  const [laneOpen, setLaneOpen] = useState(false);
  const [laneRows, setLaneRows] = useState<ElementRow[] | null>(null);
  const [dropping, setDropping] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // How far this device's clock is from the server's. A phone or PC set a few minutes off
  // would otherwise think everyone else went offline and hide their cursors.
  const clockOffset = useRef(0);
  const serverNow = useCallback(() => Date.now() + clockOffset.current, []);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [watching, setWatchingState] = useState<string | null>(null);

  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const undoStack = useRef<Change[][]>([]);
  const redoStack = useRef<Change[][]>([]);
  const ytHandlers = useRef(new Map<string, Set<(c: YtCommand) => void>>());
  const lastCursor = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef<{ id: string; t: number; x: number; y: number } | null>(null);
  // iPhones only open the keyboard when focus happens during the tap itself. Focusing this
  // hidden input then keeps the keyboard up as focus moves on to the new text or list.
  const keyboardProxy = useRef<HTMLInputElement>(null);
  const primeKeyboard = (pointerType: string) => {
    if (pointerType !== "mouse") keyboardProxy.current?.focus({ preventScroll: true });
  };

  const showToast = useCallback(
    (text: string, heart = false, action?: { label: string; run: () => void }) => setToast({ id: Date.now(), text, heart, action }),
    [],
  );
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.action ? 7000 : 3200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 5_000);
    return () => clearInterval(t);
  }, [serverNow]);

  useEffect(() => {
    const attr = document.documentElement.dataset.theme;
    // Reads the theme the pre-paint script applied; only knowable in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(attr === "dark" || (!attr && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light");
  }, []);
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("drawory:theme", next);
    } catch {}
  }

  const loadBoard = useCallback(() => {
    api.board(boardId).then((b) => {
      setBoard(b);
      rememberRoom(boardId, b.name);
    }, () => {});
  }, [boardId]);
  useEffect(loadBoard, [loadBoard]);

  /* ---------- Camera ---------- */
  // One saved view per page ("main" keeps the key it always had).
  const camKey = page === "main" ? `drawory:cam:${boardId}` : `drawory:cam:${boardId}:${page}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(camKey) ?? "null");
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.zoom)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring from localStorage after mount
        setCamera({ x: saved.x, y: saved.y, zoom: clampZoom(saved.zoom) });
        setCameraReady(true);
        return;
      }
    } catch {}
    // A page not opened on this device before: show everything on it.
    const all = unionBounds([...rowsRef.current.values()]);
    setCamera(all ? cameraFor(all, window.innerWidth, window.innerHeight) : { x: window.innerWidth / 2, y: window.innerHeight / 2, zoom: 1 });
  }, [camKey, setCamera]);
  // First visit on this device: frame everything once the board loads.
  useEffect(() => {
    if (cameraReady || !elData) return;
    const all = unionBounds(elData.filter((r) => pageOf(r) === pageRef.current));
    if (all) setCamera(cameraFor(all, window.innerWidth, window.innerHeight));
    setCameraReady(true);
  }, [cameraReady, elData, setCamera]);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(camKey, JSON.stringify(camera));
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [camera, camKey]);

  /* ---------- Proximity audio ---------- */
  const [proximityOn, setProximityOn] = useState(() => {
    try {
      return localStorage.getItem("drawory:proximity") !== "off";
    } catch {
      return true;
    }
  });
  const proximityRef = useRef(proximityOn);
  const listenerSubs = useRef(new Set<(at: { x: number; y: number }, enabled: boolean) => void>());
  const listenerNow = () => {
    const c = cam.current;
    return { x: (window.innerWidth / 2 - c.x) / c.zoom, y: (window.innerHeight / 2 - c.y) / c.zoom };
  };
  useEffect(() => {
    proximityRef.current = proximityOn;
    const at = listenerNow();
    for (const cb of listenerSubs.current) cb(at, proximityOn);
  }, [camera, proximityOn]);
  const onListener = useCallback((cb: (at: { x: number; y: number }, enabled: boolean) => void) => {
    listenerSubs.current.add(cb);
    cb(listenerNow(), proximityRef.current);
    return () => {
      listenerSubs.current.delete(cb);
    };
  }, []);

  const toWorld = useCallback((sx: number, sy: number) => {
    const c = cam.current;
    return { x: (sx - c.x) / c.zoom, y: (sy - c.y) / c.zoom };
  }, []);
  const zoomAt = useCallback(
    (sx: number, sy: number, zoom: number) => {
      const c = cam.current;
      const z = clampZoom(zoom);
      const wx = (sx - c.x) / c.zoom;
      const wy = (sy - c.y) / c.zoom;
      setCamera({ zoom: z, x: sx - wx * z, y: sy - wy * z });
    },
    [setCamera],
  );
  const flyTo = useCallback(
    (target: Camera) => {
      const start = { ...cam.current };
      const t0 = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / 420);
        const e = 1 - Math.pow(1 - k, 3);
        setCamera({
          x: start.x + (target.x - start.x) * e,
          y: start.y + (target.y - start.y) * e,
          zoom: start.zoom + (target.zoom - start.zoom) * e,
        });
        if (k < 1) nextFrame(step);
      };
      nextFrame(step);
    },
    [setCamera],
  );
  /**
   * Glides the zoom toward a target, keeping the point under (sx, sy) still. Calls made while it's
   * moving just retarget it, so fast wheel notches add up smoothly instead of stacking jumps.
   */
  const zoomAnim = useRef<{ target: number; sx: number; sy: number } | null>(null);
  const smoothZoomTo = useCallback(
    (target: number, sx = window.innerWidth / 2, sy = window.innerHeight / 2) => {
      target = clampZoom(target);
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        zoomAnim.current = null;
        zoomAt(sx, sy, target);
        return;
      }
      if (zoomAnim.current) {
        Object.assign(zoomAnim.current, { target, sx, sy });
        return;
      }
      const anim = { target, sx, sy };
      zoomAnim.current = anim;
      let last = performance.now();
      const step = (t: number) => {
        if (zoomAnim.current !== anim) return; // cancelled by a direct zoom
        const dt = Math.min(50, t - last);
        last = t;
        // Ease in log space, so zooming in and out feel the same.
        const from = Math.log(cam.current.zoom);
        const to = Math.log(anim.target);
        const k = 1 - Math.exp(-dt / 60);
        const done = Math.abs(to - from) < 0.002;
        zoomAt(anim.sx, anim.sy, done ? anim.target : Math.exp(from + (to - from) * k));
        if (done) zoomAnim.current = null;
        else nextFrame(step);
      };
      nextFrame(step);
    },
    [zoomAt],
  );
  /** Where the zoom is heading (mid-glide) or is. Steps build on this, so quick presses add up. */
  const zoomGoal = useCallback(() => zoomAnim.current?.target ?? cam.current.zoom, []);
  /** Zooms to the next step: 20% per press, and to round levels when close to one. */
  const stepZoom = useCallback(
    (direction: 1 | -1, sx?: number, sy?: number) => {
      const next = zoomGoal() * (direction > 0 ? 1.2 : 1 / 1.2);
      const round = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8].find((r) => Math.abs(Math.log(r / next)) < 0.06);
      smoothZoomTo(round ?? next, sx, sy);
    },
    [smoothZoomTo, zoomGoal],
  );
  const centerWorld = useCallback(() => toWorld(window.innerWidth / 2, window.innerHeight / 2), [toWorld]);
  /** Every new element belongs to the page I'm on. */
  const mkRow = useCallback(
    (type: ElementType, data: ElementData, z: number, by: string) => makeRow(type, { ...data, page: pageRef.current }, z, by),
    [],
  );
  const nextZ = useCallback(() => {
    let max = 0;
    for (const r of rowsRef.current.values()) max = Math.max(max, r.z);
    return max + 1;
  }, []);

  /* ---------- Writes ---------- */
  const send = useCallback(
    async (changes: Change[], record = true) => {
      if (changes.length === 0) return;
      if (record) {
        undoStack.current.push(changes);
        if (undoStack.current.length > 100) undoStack.current.shift();
        redoStack.current = [];
      }
      const v = ++versionCounter.current;
      const ids = changes.map((c) => (c.after ?? c.before)!.id);
      setOverlay((prev) => {
        const next = new Map(prev);
        changes.forEach((c, i) => next.set(ids[i], { row: c.after, v }));
        return next;
      });
      try {
        const ops = changes.map((c, i) =>
          c.after
            ? { op: "upsert" as const, id: c.after.id, type: c.after.type, data: c.after.data, z: c.after.z }
            : { op: "delete" as const, id: ids[i] },
        );
        for (let i = 0; i < ops.length; i += 200) {
          const res = await withRetry(() => api.applyOps(boardId, ops.slice(i, i + 200), me.id));
          if (res.txid) await awaitTxId(res.txid);
        }
      } catch (e) {
        showToast(`Couldn't save: ${e instanceof Error ? e.message : "try again"}`);
      } finally {
        setOverlay((prev) => {
          const next = new Map(prev);
          for (const id of ids) if (next.get(id)?.v === v) next.delete(id);
          return next;
        });
      }
    },
    [boardId, me.id, awaitTxId, showToast],
  );
  const preview = useCallback(
    (list: { id: string; row: ElementRow | null }[]) => {
      const v = ++versionCounter.current;
      setOverlay((prev) => {
        const next = new Map(prev);
        for (const { id, row } of list) next.set(id, { row, v });
        return next;
      });
    },
    [],
  );
  const dropPreview = useCallback(
    (id: string) => {
      setOverlay((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    },
    [],
  );
  const addRow = useCallback(
    (type: ElementType, data: ElementData, select = true) => {
      const row = mkRow(type, data, nextZ(), me.id);
      void send([{ before: null, after: row }]);
      if (select) setSelectedId(row.id);
      return row;
    },
    [me.id, mkRow, nextZ, send, setSelectedId],
  );
  const undo = useCallback(() => {
    const changes = undoStack.current.pop();
    if (!changes) return;
    redoStack.current.push(changes);
    void send(changes.map((c) => ({ before: c.after, after: c.before })).reverse(), false);
  }, [send]);
  const redo = useCallback(() => {
    const changes = redoStack.current.pop();
    if (!changes) return;
    undoStack.current.push(changes);
    void send(changes, false);
  }, [send]);

  const patch = useCallback(
    (id: string, data: Partial<ElementData>, commit = true) => {
      const row = rowsRef.current.get(id);
      if (!row) return;
      if (row.type === "sticky" && data.color) setStickyColor(data.color);
      const after = { ...row, data: { ...row.data, ...data }, updated_at: new Date() };
      if (commit) void send([{ before: committedRef.current.get(id) ?? null, after }]);
      else preview([{ id, row: after }]);
    },
    [send, preview],
  );
  const deleteIds = useCallback(
    (ids: string[]) => {
      const changes = ids
        .map((id) => rowsRef.current.get(id))
        .filter((r): r is ElementRow => !!r)
        .map((r) => ({ before: committedRef.current.get(r.id) ?? r, after: null }));
      void send(changes);
      setSelectedId(null);
    },
    [send, setSelectedId],
  );

  /* ---------- Presence ---------- */
  const presenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPresence = useRef(0);
  const toolRef = useRef(tool);
  const watchingRef = useRef(watching);
  useEffect(() => {
    toolRef.current = tool;
    watchingRef.current = watching;
  }, [tool, watching]);
  // What I'm doing right now (see Activity). Others render it live in my color.
  const activityRef = useRef<Activity | null>(null);
  const presenceInflight = useRef(false);
  const presencePending = useRef(false);
  const pushPresenceRef = useRef<(hidden?: boolean, leaving?: boolean) => void>(() => {});
  /** Server time from either the relay or a presence write; rtt is the round trip it took. */
  const applyClock = useCallback((serverTime: number, rtt: number) => {
    // Only trust quick round trips; a slow one says little about the clock.
    if (!serverTime || rtt >= 2_000) return;
    const offset = serverTime + rtt / 2 - Date.now();
    const jump = Math.abs(offset - clockOffset.current) > 1_000;
    clockOffset.current = offset;
    if (jump) setNow(Date.now() + offset);
  }, []);
  // The room's live relay: cursors and live activity reach others in milliseconds.
  const sock = useRoomSocket(boardId, me.id, applyClock);
  const sockRef = useRef(sock);
  useEffect(() => {
    sockRef.current = sock;
  });
  const lastDbPresence = useRef({ at: 0, kind: "" as string });

  const pushPresence = useCallback(
    (hidden = false, leaving = false) => {
      const c = cam.current;
      const activity = hidden ? null : activityRef.current;
      const body = {
        user_id: me.id,
        name: me.name,
        color: me.color,
        cursor_x: hidden ? null : lastCursor.current?.x ?? null,
        cursor_y: hidden ? null : lastCursor.current?.y ?? null,
        view_x: c.x,
        view_y: c.y,
        view_w: window.innerWidth,
        view_h: window.innerHeight,
        zoom: c.zoom,
        tool: toolRef.current,
        watching: watchingRef.current,
        page: pageRef.current,
        activity,
      };
      // Everyone on the relay gets every update straight away.
      const viaRelay = sockRef.current.send({ t: "p", p: body });
      // The database copy is for anyone who can't reach the relay, and remembers "was here".
      // With the relay up it only needs refreshing every few seconds, or when what I'm doing changes
      // (so nobody is left looking at a stroke I already finished).
      const kind = activity?.k ?? "";
      const db = lastDbPresence.current;
      if (viaRelay && !hidden && !leaving && kind === db.kind && Date.now() - db.at < 4_000) return;
      // One database write in flight at a time; the latest state goes out as soon as it lands.
      if (presenceInflight.current && !hidden && !leaving) {
        presencePending.current = true;
        return;
      }
      presenceInflight.current = true;
      lastDbPresence.current = { at: Date.now(), kind };
      const sentAt = Date.now();
      void api
        .presence(boardId, body, leaving)
        .then((res) => {
          if (res?.now) applyClock(res.now, Date.now() - sentAt);
        })
        .catch(() => {})
        .finally(() => {
          presenceInflight.current = false;
          if (presencePending.current) {
            presencePending.current = false;
            pushPresenceRef.current();
          }
        });
    },
    [boardId, me, applyClock],
  );
  useEffect(() => {
    pushPresenceRef.current = pushPresence;
  }, [pushPresence]);
  const schedulePresence = useCallback(() => {
    if (presenceTimer.current) return;
    // While actively drawing/dragging/typing, update faster so others see it smoothly.
    // Over the relay that's ~40 times a second; through the database, ~25.
    const busy = activityRef.current && activityRef.current.k !== "select";
    const relay = sockRef.current.connected;
    const gap = relay ? (busy ? 25 : 40) : busy ? 40 : 70;
    const wait = Math.max(0, gap - (Date.now() - lastPresence.current));
    presenceTimer.current = setTimeout(() => {
      presenceTimer.current = null;
      lastPresence.current = Date.now();
      pushPresence();
    }, wait);
  }, [pushPresence]);
  useEffect(() => {
    pushPresence();
    const beat = setInterval(() => !document.hidden && pushPresence(), 15_000);
    const onVis = () => pushPresence(document.hidden);
    const onLeave = () => pushPresence(true, true);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onLeave);
    return () => {
      clearInterval(beat);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onLeave);
    };
  }, [pushPresence]);
  useEffect(schedulePresence, [camera, tool, watching, page, schedulePresence]);

  // Activity: set while a gesture runs, then back to "what I have selected" shortly after it
  // ends (long enough for the saved result to reach everyone, so nothing flickers).
  const activityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedIdsRef = useRef<string[]>([]);
  const idleActivity = (): Activity | null => {
    const ids = selectedIdsRef.current;
    return ids.length ? { k: "select", ids: ids.slice(0, 100) } : null;
  };
  const setActivity = useCallback(
    (a: Activity) => {
      if (activityTimer.current) clearTimeout(activityTimer.current);
      activityTimer.current = null;
      activityRef.current = a;
      schedulePresence();
    },
    [schedulePresence],
  );
  const endActivity = useCallback(
    (delay = 600) => {
      if (activityTimer.current) clearTimeout(activityTimer.current);
      activityTimer.current = setTimeout(() => {
        activityTimer.current = null;
        activityRef.current = idleActivity();
        schedulePresence();
      }, delay);
    },
    [schedulePresence],
  );
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
    const a = activityRef.current;
    if (!a || a.k === "select") {
      activityRef.current = idleActivity();
      schedulePresence();
    }
  }, [selectedIds, schedulePresence]);

  // Everyone else who has ever opened this board, most recently active first.
  const others = useMemo(() => {
    const merged = new Map<string, PresenceRow>();
    for (const p of sync.presence ?? []) if (p.user_id !== me.id) merged.set(p.user_id, p);
    // Anyone on the relay: use its far fresher copy.
    for (const [id, p] of sock.peers) if (id !== me.id) merged.set(id, p);
    return [...merged.values()].sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());
  }, [sync.presence, sock.peers, me.id]);
  const online = useMemo(() => others.filter((p) => now - p.updated_at.getTime() < ONLINE_MS), [others, now]);
  // Cursors, live activity and edge markers only for people on the same page.
  const onlineHere = useMemo(() => online.filter((p) => (p.page ?? "main") === page), [online, page]);
  // The most recent other person, for the "was here" line when nobody else is online.
  const partner = online[0] ?? others[0] ?? null;
  const partnerOnline = online.length > 0;
  const places = useMemo(
    () => rows.filter((r) => r.type === "place").sort((a, b) => a.created_at.getTime() - b.created_at.getTime()),
    [rows],
  );
  const placeAt = useCallback(
    (wx: number, wy: number) => places.find((p) => contains(bounds(p), { x: wx, y: wy, w: 0, h: 0 })) ?? null,
    [places],
  );
  const placeOf = useCallback(
    (p: PresenceRow) => (p.zoom ? placeAt((p.view_w / 2 - p.view_x) / p.zoom, (p.view_h / 2 - p.view_y) / p.zoom) : null),
    [placeAt],
  );
  const partnerPlace = useMemo(() => (online.length === 1 ? placeOf(online[0]) : null), [online, placeOf]);
  const myPlace = useMemo(() => {
    if (typeof window === "undefined") return null;
    return placeAt((window.innerWidth / 2 - camera.x) / camera.zoom, (window.innerHeight / 2 - camera.y) / camera.zoom);
  }, [camera, placeAt]);

  // Follow someone's view: same world centre, zoomed so everything they see fits on this
  // screen (a laptop's view on a phone, or a phone's view on a laptop).
  const followed = followId ? online.find((p) => p.user_id === followId) ?? null : null;
  const followActive = !!followed;
  const followedPage = followed?.page ?? null;
  useEffect(() => {
    // Follow them onto their page.
    if (followedPage && followedPage !== pageRef.current) {
      setPageChoice(followedPage);
    }
  }, [followedPage]);
  useEffect(() => {
    if (!followed) return;
    const fz = followed.zoom || 1;
    const theirW = (followed.view_w || window.innerWidth) / fz;
    const theirH = (followed.view_h || window.innerHeight) / fz;
    const z = clampZoom(Math.min(window.innerWidth / theirW, window.innerHeight / theirH));
    const cx = (followed.view_w / 2 - followed.view_x) / fz;
    const cy = (followed.view_h / 2 - followed.view_y) / fz;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors their camera as their presence row changes
    setCamera({ zoom: z, x: window.innerWidth / 2 - cx * z, y: window.innerHeight / 2 - cy * z });
  }, [followed, setCamera]);

  // People whose cursor (or, without one, view) is off this screen get a marker at the edge
  // pointing to them, so nobody is ever invisible. Tap it to jump there.
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const edgeMarkers = useMemo(() => {
    const margin = 28;
    const top = 84;
    const bottom = vp.h - (vp.w <= 720 ? 150 : 100);
    return onlineHere.flatMap((p) => {
      const hasCursor = p.cursor_x != null && p.cursor_y != null;
      const fz = p.zoom || 1;
      const wx = hasCursor ? p.cursor_x! : (p.view_w / 2 - p.view_x) / fz;
      const wy = hasCursor ? p.cursor_y! : (p.view_h / 2 - p.view_y) / fz;
      const sx = wx * camera.zoom + camera.x;
      const sy = wy * camera.zoom + camera.y;
      if (sx >= 0 && sx <= vp.w && sy >= top && sy <= bottom) return [];
      const x = Math.min(Math.max(sx, margin), vp.w - margin);
      const y = Math.min(Math.max(sy, top + margin), bottom - margin);
      return [{ p, x, y, wx, wy, angle: Math.atan2(sy - y, sx - x) }];
    });
  }, [onlineHere, camera, vp]);

  /* ---------- Chat boxes ---------- */
  // Each chat box on the board is a thread of messages (thread = its id).
  const allChat = sync.chat;
  const threads = useMemo(() => {
    const map = new Map<string, ChatRow[]>();
    for (const m of allChat ?? []) {
      if (!m.thread) continue;
      const list = map.get(m.thread);
      if (list) list.push(m);
      else map.set(m.thread, [m]);
    }
    return map;
  }, [allChat]);
  const sendTo = useCallback(
    (thread: string | null, body: string) => api.sendMessage(boardId, { user_id: me.id, name: me.name, color: me.color, body, thread }),
    [boardId, me],
  );

  /* ---------- Signals: hearts, synced video ---------- */
  const spawnHearts = useCallback((x: number, y: number) => {
    const base = Date.now();
    const burst = Array.from({ length: 7 }, (_, i) => ({
      id: base + i + Math.random(),
      x: x + (Math.random() - 0.5) * 30,
      y,
      dx: (Math.random() - 0.5) * 120,
      delay: i * 90,
    }));
    setHearts((h) => [...h, ...burst]);
    setTimeout(() => setHearts((h) => h.filter((p) => !burst.includes(p))), 2400);
  }, []);
  const seenSignals = useRef<Set<string> | null>(null);
  const othersRef = useRef(others);
  useEffect(() => {
    othersRef.current = others;
  }, [others]);
  // Waves and video sync can arrive twice: instantly over the relay, then again from the database
  // (which is how people without the relay get them). `sid` tells the copies apart.
  const seenSids = useRef(new Set<string>());
  const handleSignal = useCallback(
    (kind: string, from: string, payload: Record<string, unknown>) => {
      const sid = typeof payload.sid === "string" ? payload.sid : null;
      if (sid) {
        if (seenSids.current.has(sid)) return;
        seenSids.current.add(sid);
        if (seenSids.current.size > 500) seenSids.current = new Set([...seenSids.current].slice(-200));
      }
      if (kind === "wave" || kind === "heart") {
        const p = othersRef.current.find((o) => o.user_id === from);
        const c = cam.current;
        const visible = p?.cursor_x != null && p.cursor_y != null;
        const x = visible ? p!.cursor_x! * c.zoom + c.x : window.innerWidth - 220;
        const y = visible ? p!.cursor_y! * c.zoom + c.y : 90;
        spawnHearts(Math.min(Math.max(x, 40), window.innerWidth - 40), Math.min(Math.max(y, 120), window.innerHeight - 40));
        showToast(`${p?.name ?? "Someone"} waved at you`, true);
      } else if (kind === "yt") {
        const cmd = payload as { elementId?: string } & YtCommand;
        if (cmd.elementId) ytHandlers.current.get(cmd.elementId)?.forEach((h) => h(cmd));
      } else if (kind === "board") {
        loadBoard();
      }
    },
    [spawnHearts, showToast, loadBoard],
  );
  useEffect(() => {
    const data = sync.signals;
    if (!data) return;
    if (!seenSignals.current) {
      seenSignals.current = new Set(data.map((s) => s.id));
      return;
    }
    for (const s of [...data].reverse()) {
      if (seenSignals.current.has(s.id)) continue;
      seenSignals.current.add(s.id);
      if (s.from_user !== me.id) handleSignal(s.kind, s.from_user, s.payload ?? {});
    }
  }, [sync.signals, me.id, handleSignal]);
  const onRelaySignal = sock.onSignal;
  useEffect(() => onRelaySignal((s) => handleSignal(s.kind, s.from, s.payload)), [onRelaySignal, handleSignal]);

  /** Sends over the relay (instant) and the database (reaches everyone, kept briefly). */
  const sendSignal = useCallback(
    (kind: "wave" | "yt", payload: Record<string, unknown> = {}) => {
      const withSid = { ...payload, sid: newId() };
      sockRef.current.send({ t: "s", kind, payload: withSid });
      return api.signal(boardId, kind, me.id, withSid);
    },
    [boardId, me.id],
  );

  function sendWave(e: React.MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    spawnHearts(r.left + r.width / 2, r.top + r.height);
    void sendSignal("wave").catch(() => showToast("Couldn't send the wave"));
  }

  /* ---------- Now playing ---------- */
  // Everything playing in the room (by me or anyone online), newest-joined first, any page.
  const nowPlaying = useMemo<PlayingItem[]>(() => {
    const byId = new Map<string, PlayingItem>();
    const add = (id: string | null, person: { name: string; color: string; me: boolean }) => {
      if (!id) return;
      const row = committed.get(id) ?? rowsById.get(id);
      if (!row || (row.type !== "youtube" && row.type !== "video" && row.type !== "audio")) return;
      let item = byId.get(id);
      if (!item) {
        const title =
          row.type === "youtube" ? row.data.title || "YouTube video" : row.type === "audio" ? `Voice note${row.data.fromName ? ` from ${row.data.fromName}` : ""}` : "Video";
        const pg = pageOf(row);
        item = { id, title, kind: row.type, people: [], elsewhere: pg !== page ? pages.find((p) => p.id === pg)?.name ?? "another page" : null };
        byId.set(id, item);
      }
      item.people.push(person);
    };
    add(watching, { name: me.name, color: me.color, me: true });
    for (const p of online) add(p.watching, { name: p.name, color: p.color, me: false });
    return [...byId.values()];
  }, [watching, online, committed, rowsById, me.name, me.color, page, pages]);

  function jumpToElement(id: string) {
    const row = committed.get(id) ?? rowsById.get(id);
    if (!row) return;
    setFollowId(null);
    const go = () => flyTo(cameraFor(bounds(row), window.innerWidth, window.innerHeight, 160));
    if (pageOf(row) !== page) {
      switchPage(pageOf(row));
      setTimeout(go, 80); // after the new page's own view is restored
    } else go();
    setSelectedId(row.id);
  }

  /* ---------- Pages ---------- */
  function switchPage(id: string) {
    if (id === page) return;
    setPageChoice(id);
    try {
      localStorage.setItem(pageKey, id);
    } catch {}
    setSelectedIds([]);
    setEditingId(null);
    setMarquee(null);
    endActivity(0);
  }
  async function savePages(next: BoardPage[]) {
    setBoard((b) => (b ? { ...b, pages: next } : b));
    try {
      setBoard(await api.updateBoard(boardId, { pages: next, from: me.id }));
    } catch {
      showToast("Couldn't save the pages");
      loadBoard();
    }
  }
  function addPage() {
    const id = `p-${Math.random().toString(36).slice(2, 8)}`;
    void savePages([...pages, { id, name: `Page ${pages.length + 1}` }]);
    switchPage(id);
  }
  function deletePage(id: string) {
    if (pages.length <= 1) return;
    const victims = [...committedRef.current.values()].filter((r) => pageOf(r) === id);
    if (victims.length) void send(victims.map((r) => ({ before: r, after: null })), false);
    const rest = pages.filter((p) => p.id !== id);
    void savePages(rest);
    if (id === page) switchPage(rest[0].id);
  }
  function clearPage() {
    const ids = [...rowsRef.current.keys()];
    if (!ids.length) return;
    deleteIds(ids);
    showToast(`Cleared ${ids.length} ${ids.length === 1 ? "thing" : "things"}`, false, { label: "Undo", run: undo });
  }

  async function copyInvite() {
    const link = inviteLink(boardId);
    try {
      await navigator.clipboard.writeText(link);
      showToast(`Invite link copied · code ${displayCode(boardId)}`);
    } catch {
      window.prompt("Copy this invite link", link);
    }
  }

  /* ---------- Adding things ---------- */
  const placeNear = useCallback(
    (w: number, h: number, at?: { x: number; y: number }, offset = 0) => {
      const c = at ?? centerWorld();
      return { x: Math.round(c.x - w / 2 + offset), y: Math.round(c.y - h / 2 + offset) };
    },
    [centerWorld],
  );

  const addLink = useCallback(
    async (d: DetectedLink, at?: { x: number; y: number }) => {
      if (d.kind === "youtube") {
        const meta = await api.unfurl(d.url).catch(() => null);
        const title = meta?.title && meta.title !== "youtube.com" ? meta.title.replace(/ - YouTube$/, "") : "";
        addRow("youtube", { ...placeNear(480, 344, at), w: 480, h: 344, videoId: d.videoId, url: d.url, title });
      } else if (d.kind === "embed") {
        const h = d.h || 290;
        addRow("embed", { ...placeNear(d.provider === "Spotify" ? 380 : 480, h, at), w: d.provider === "Spotify" ? 380 : 480, h, src: d.src, url: d.url, provider: d.provider });
      } else if (d.kind === "image") {
        const s = await imageSize(d.url);
        const f = fitWithin(s.w, s.h, 420);
        addRow("image", { ...placeNear(f.w + 12, f.h + 16, at), w: f.w + 12, h: f.h + 16, src: d.url });
      } else if (d.kind === "video") {
        const s = await videoSize(d.url);
        const f = fitWithin(s.w, s.h, 480);
        addRow("video", { ...placeNear(f.w + 12, f.h + 16, at), w: f.w + 12, h: f.h + 16, src: d.url });
      } else {
        const meta = await api.unfurl(d.url).catch(() => null);
        addRow("link", {
          ...placeNear(280, 200, at),
          w: 280,
          url: d.url,
          title: meta?.title ?? d.url,
          description: meta?.description,
          image: meta?.image,
          site: meta?.site ?? new URL(d.url).hostname,
        });
      }
    },
    [addRow, placeNear],
  );

  const addFiles = useCallback(
    async (files: File[], at?: { x: number; y: number }) => {
      let offset = 0;
      for (const original of files) {
        const file = await shrinkPhoto(original);
        if (file.size > 25 * 1024 * 1024) throw new Error(`${file.name} is over 25 MB`);
        const up = await api.upload(boardId, file, file.name);
        if (up.mime.startsWith("image/")) {
          const s = await imageSize(up.url);
          const f = fitWithin(s.w, s.h, 420);
          addRow("image", { ...placeNear(f.w + 12, f.h + 16, at, offset), w: f.w + 12, h: f.h + 16, src: up.url });
        } else if (up.mime.startsWith("video/")) {
          const s = await videoSize(up.url);
          const f = fitWithin(s.w, s.h, 480);
          addRow("video", { ...placeNear(f.w + 12, f.h + 16, at, offset), w: f.w + 12, h: f.h + 16, src: up.url });
        } else {
          const { peaks, duration } = await audioPeaks(file);
          addRow("audio", { ...placeNear(320, 64, at, offset), w: 320, src: up.url, peaks, duration, fromName: me.name, color: me.color });
        }
        offset += 32;
      }
    },
    [addRow, boardId, me.name, me.color, placeNear],
  );

  async function addVoice(blob: Blob) {
    const ext = blob.type.includes("mp4") ? "m4a" : "webm";
    const up = await api.upload(boardId, blob, `voice-note.${ext}`);
    const { peaks, duration } = await audioPeaks(blob);
    addRow("audio", { ...placeNear(320, 64), w: 320, src: up.url, peaks, duration, fromName: me.name, color: me.color });
  }

  async function sealCapsule(v: { title: string; body: string; unlockAt: Date }) {
    const id = newId();
    const res = await api.sealCapsule(boardId, {
      id,
      title: v.title,
      body: v.body,
      unlockAt: v.unlockAt.toISOString(),
      ...placeNear(300, 190),
      z: nextZ(),
      author: me.id,
      authorName: me.name,
      page: pageRef.current,
    });
    if (res.txid) await awaitTxId(res.txid);
    setSelectedId(id);
  }

  function createPlace(name: string) {
    const c = cam.current;
    const w = Math.min(1200, (window.innerWidth * 0.6) / c.zoom);
    const h = Math.min(800, (window.innerHeight * 0.55) / c.zoom);
    addRow("place", { ...placeNear(w, h), w: Math.round(w), h: Math.round(h), name });
  }

  async function addSticker(s: Sticker) {
    const size = await imageSize(s.url);
    const f = fitWithin(size.w, size.h, 160);
    addRow("sticker", { ...placeNear(f.w, f.h), w: f.w, h: f.h, src: s.url, name: s.name });
    setTool("select");
  }

  function chooseTool(t: Tool) {
    if (t === "sticker") return setStickersOpen((o) => !o);
    if (t === "chatbox") {
      const row = addRow("chatbox", { ...placeNear(320, 400), w: 320, h: 400, title: "Chat" });
      setTool("select");
      // Ready to type straight away.
      setTimeout(() => document.getElementById(`chatbox-${row.id}`)?.focus(), 250);
      return;
    }
    if (t === "window") {
      // Starts empty, showing templates to pick from.
      addRow("window", { ...placeNear(640, 300), w: 640, title: "Window", blocks: [] });
      setTool("select");
      return;
    }
    if (t === "media") return setDialog({ kind: "media" });
    if (t === "youtube") return setDialog({ kind: "media", url: "" });
    if (t === "voice") return setDialog({ kind: "voice" });
    if (t === "capsule") return setDialog({ kind: "capsule" });
    setTool(t);
    if (t !== "select") setSelectedId(null);
  }

  /* ---------- Pointer gestures ---------- */
  const strokeData = useCallback(
    (points: number[][]): ElementData => {
      const px = STROKE_SIZES.find((s) => s.id === sizeId)?.px ?? 6;
      return { ...normalizePoints(points, px), size: px, color: colorId };
    },
    [sizeId, colorId],
  );

  const eraseAt = useCallback(
    (clientX: number, clientY: number, g: Extract<Gesture, { kind: "erase" }>) => {
      const hits: { id: string; row: null }[] = [];
      for (const node of document.elementsFromPoint(clientX, clientY)) {
        const id = (node as HTMLElement).closest?.("[data-el]")?.getAttribute("data-el");
        if (!id || g.originals.has(id)) continue;
        const row = rowsRef.current.get(id);
        if (!row || row.type === "place") continue;
        g.originals.set(id, committedRef.current.get(id) ?? row);
        hits.push({ id, row: null });
      }
      if (hits.length) {
        preview(hits);
        setActivity({ k: "erase", ids: [...g.originals.keys()].slice(0, 200) });
      }
    },
    [preview, setActivity],
  );

  /** Abandons a gesture without saving it, putting back anything it was previewing. */
  function cancelGesture(g: Gesture | null) {
    setDraft(null);
    endActivity(0);
    if (!g) return;
    if (g.kind === "pan" && g.hold) clearTimeout(g.hold);
    if (g.kind === "move" && g.moved) g.originals.forEach((r) => dropPreview(r.id));
    if (g.kind === "resize") dropPreview(g.original.id);
    if (g.kind === "erase") g.originals.forEach((_, id) => dropPreview(id));
    if (g.kind === "marquee") {
      setMarquee(null);
      setSelectedIds(g.base);
    }
  }

  /** Shares a stroke in progress. Long ones are thinned so the update stays small. */
  function shareStroke(points: number[][]) {
    const step = Math.ceil(points.length / 400);
    const pts = points.filter((_, i) => i % step === 0 || i === points.length - 1).map(([x, y]) => [Math.round(x), Math.round(y)]);
    setActivity({ k: "draw", pts, c: colorId, s: STROKE_SIZES.find((s) => s.id === sizeId)?.px ?? 6 });
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (tool === "select" && !laneOpen && target.closest("[data-interactive]")) return;
    // Chat boxes take typing and scrolling with any tool.
    if (!laneOpen && target.closest(".chatbox [data-interactive]")) return;
    // Clicks inside the thing being edited go to it (placing the caret, selecting text).
    if (editingId && target.closest(`[data-el="${editingId}"]`)) return;
    if (editingId) {
      // A click away finishes what you were editing, and does nothing else.
      // Text is saved straight from the box rather than relying on the blur event.
      const editingRow = rowsRef.current.get(editingId);
      if (editingRow?.type === "text") {
        const box = rootRef.current?.querySelector<HTMLElement>(`[data-el="${editingId}"] .text-body`);
        finishText(editingId, box?.innerText ?? "");
      } else if (editingRow?.type === "sticky") {
        const area = rootRef.current?.querySelector<HTMLTextAreaElement>(`[data-el="${editingId}"] textarea.sticky-text`);
        if (area && area.value !== (editingRow.data.text ?? "")) patch(editingId, { text: area.value });
      }
      (document.activeElement as HTMLElement | null)?.blur?.();
      setEditingId(null);
      e.preventDefault();
      return;
    }
    // Stop the browser's own mousedown handling, which would steal focus back from a
    // text box or list we create on this click and make it vanish as "empty".
    e.preventDefault();
    setMenuOpen(false);
    e.currentTarget.setPointerCapture(e.pointerId);
    // A new mouse press or first finger starts fresh, even if a release was missed
    // (e.g. let go outside the window); otherwise it would be mistaken for a pinch.
    if (e.isPrimary) pointers.current.clear();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // A tap has no movement before it, so it updates where others see you here.
    if (e.isPrimary) {
      lastCursor.current = toWorld(e.clientX, e.clientY);
      schedulePresence();
    }

    if (pointers.current.size === 2) {
      // Second finger: switch to pinch zoom, undoing whatever the first finger had started.
      const [a, b] = [...pointers.current.values()];
      cancelGesture(gesture.current);
      gesture.current = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cam: { ...cam.current } };
      return;
    }
    if (pointers.current.size > 2) return;

    const w = toWorld(e.clientX, e.clientY);
    const panning = laneOpen || tool === "hand" || spaceHeld || e.button === 1;
    if (panning) {
      setFollowing(false);
      gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, cam: { ...cam.current } };
      return;
    }

    const elId = target.closest("[data-el]")?.getAttribute("data-el") ?? null;
    switch (tool) {
      case "select": {
        if (target.closest("[data-handle]") && selectedId) {
          const original = rowsRef.current.get(selectedId);
          if (original) gesture.current = { kind: "resize", wx: w.x, wy: w.y, original };
          return;
        }
        if (elId) {
          const row = rowsRef.current.get(elId);
          if (!row) return;
          // Touch has no double-click: a second tap on the same thing opens it for editing.
          if (e.pointerType !== "mouse") {
            const last = lastTap.current;
            const again = last?.id === elId && e.timeStamp - last.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30;
            lastTap.current = again ? null : { id: elId, t: e.timeStamp, x: e.clientX, y: e.clientY };
            if (again && EDITABLE.includes(row.type)) {
              primeKeyboard(e.pointerType);
              setSelectedId(elId);
              setEditingId(elId);
              return;
            }
          }
          if (e.shiftKey || e.ctrlKey || e.metaKey) {
            // Add to or remove from the selection, like Ctrl/Shift-click in a file manager.
            setSelectedIds((ids) => (ids.includes(elId) ? ids.filter((i) => i !== elId) : [...ids, elId]));
            return;
          }
          // Dragging any selected item moves the whole selection.
          const group = selectedSet.has(elId) ? selectedIds : [elId];
          if (!selectedSet.has(elId)) setSelectedId(elId);
          const ids = new Set(group);
          for (const id of group) {
            const r = rowsRef.current.get(id);
            if (r?.type !== "place") continue;
            const area = bounds(r);
            for (const other of rowsRef.current.values()) if (other.type !== "place" && contains(area, bounds(other))) ids.add(other.id);
          }
          const originals = [...ids].map((id) => rowsRef.current.get(id)).filter((r): r is ElementRow => !!r);
          gesture.current = {
            kind: "move",
            wx: w.x,
            wy: w.y,
            originals,
            moved: false,
            canDrop: originals.length <= 12 && originals.every((r) => r.type !== "window" && blockFromElement(r)),
          };
          return;
        }
        // Empty canvas: draw a selection box. Shift/Ctrl adds to what's already selected.
        const base = e.shiftKey || e.ctrlKey || e.metaKey ? selectedIds : [];
        if (!base.length) setSelectedIds([]);
        setFollowing(false);
        if (e.pointerType === "touch") {
          // A finger drags the board around; press and hold first to draw a selection box.
          const g: Gesture = { kind: "pan", sx: e.clientX, sy: e.clientY, cam: { ...cam.current } };
          g.hold = setTimeout(() => {
            if (gesture.current !== g) return;
            navigator.vibrate?.(10);
            gesture.current = { kind: "marquee", wx: w.x, wy: w.y, base: [] };
            setMarquee({ x: w.x, y: w.y, w: 0, h: 0 });
          }, HOLD_TO_SELECT_MS);
          gesture.current = g;
          return;
        }
        gesture.current = { kind: "marquee", wx: w.x, wy: w.y, base };
        return;
      }
      case "pen": {
        const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
        gesture.current = { kind: "draw", points: [[w.x, w.y, pressure]] };
        setDraft(mkRow("stroke", strokeData([[w.x, w.y, pressure]]), nextZ(), me.id));
        shareStroke([[w.x, w.y]]);
        return;
      }
      case "eraser": {
        const g: Gesture = { kind: "erase", originals: new Map() };
        gesture.current = g;
        eraseAt(e.clientX, e.clientY, g);
        return;
      }
      case "rect":
      case "ellipse":
      case "arrow":
        gesture.current = { kind: "shape", type: tool, ox: w.x, oy: w.y };
        return;
      case "text": {
        primeKeyboard(e.pointerType);
        const existing = elId ? rowsRef.current.get(elId) : null;
        if (existing?.type === "text") {
          setEditingId(existing.id);
          return;
        }
        const size = textSize;
        const row = mkRow("text", { x: w.x, y: w.y - size * 0.7, text: "", size, color: colorId, font: fontId }, nextZ(), me.id);
        preview([{ id: row.id, row }]);
        setEditingId(row.id);
        setActivity({ k: "typing", id: row.id, text: "", d: row.data });
        return;
      }
      case "sticky": {
        primeKeyboard(e.pointerType);
        const row = addRow("sticky", { x: w.x - 100, y: w.y - 100, w: 200, h: 200, text: "", color: stickyColor });
        setEditingId(row.id);
        setTool("select");
        return;
      }
      case "note": {
        primeKeyboard(e.pointerType);
        const row = addRow("note", { x: w.x - 130, y: w.y - 30, w: 260, title: "New list", items: [] });
        setEditingId(row.id);
        setTool("select");
        return;
      }
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const w = toWorld(e.clientX, e.clientY);
    lastCursor.current = w;
    schedulePresence();
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;

    switch (g.kind) {
      case "pan":
        if (g.hold && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 8) {
          clearTimeout(g.hold);
          g.hold = undefined;
        }
        setCamera({ ...g.cam, x: g.cam.x + e.clientX - g.sx, y: g.cam.y + e.clientY - g.sy });
        break;
      case "pinch": {
        const [a, b] = [...pointers.current.values()];
        if (!a || !b) break;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        zoomAnim.current = null;
        const z = clampZoom(g.cam.zoom * (d / Math.max(g.d0, 1)));
        const wx = (g.mx - g.cam.x) / g.cam.zoom;
        const wy = (g.my - g.cam.y) / g.cam.zoom;
        setCamera({ zoom: z, x: mx - wx * z, y: my - wy * z });
        break;
      }
      case "draw": {
        const last = g.points[g.points.length - 1];
        if (Math.hypot(w.x - last[0], w.y - last[1]) * cam.current.zoom < 1.5) break;
        g.points.push([w.x, w.y, e.pointerType === "pen" ? e.pressure || 0.5 : 0.5]);
        if (draftRef.current) setDraft({ ...draftRef.current, data: strokeData(g.points) });
        shareStroke(g.points);
        break;
      }
      case "shape": {
        let dx = w.x - g.ox;
        let dy = w.y - g.oy;
        if (e.shiftKey && g.type !== "arrow") {
          const s = Math.max(Math.abs(dx), Math.abs(dy));
          dx = Math.sign(dx || 1) * s;
          dy = Math.sign(dy || 1) * s;
        }
        const width = SHAPE_WIDTHS[sizeId - 1] ?? 3.5;
        let shapeRow: ElementRow;
        if (g.type === "arrow") {
          const pad = 20;
          const x = Math.min(g.ox, g.ox + dx) - pad;
          const y = Math.min(g.oy, g.oy + dy) - pad;
          shapeRow = mkRow("arrow", {
            x, y, w: Math.abs(dx) + pad * 2, h: Math.abs(dy) + pad * 2, color: colorId, size: width,
            points: [[g.ox - x, g.oy - y], [g.ox + dx - x, g.oy + dy - y]],
          }, nextZ(), me.id);
        } else {
          shapeRow = mkRow(g.type, {
            x: Math.min(g.ox, g.ox + dx), y: Math.min(g.oy, g.oy + dy), w: Math.abs(dx), h: Math.abs(dy), color: colorId, size: width,
          }, nextZ(), me.id);
        }
        setDraft(shapeRow);
        setActivity({ k: "shape", t: g.type, d: shapeRow.data });
        break;
      }
      case "move": {
        let dx = w.x - g.wx;
        let dy = w.y - g.wy;
        if (!g.moved && Math.hypot(dx, dy) * cam.current.zoom < 3) break;
        g.moved = true;
        // Over a window: it'll drop in there, so no snapping.
        g.into = g.canDrop ? windowDropAt(e.clientX, e.clientY, g.originals) : null;
        markDrop(g.into);
        // Snap to nearby items' edges and centres, or dock beside them. Hold Alt to place freely.
        const box = unionBounds(g.originals);
        if (g.into) setGuides([]);
        else if (box && !e.altKey && g.originals.length <= 40) {
          const moving = new Set(g.originals.map((r) => r.id));
          const others: ReturnType<typeof bounds>[] = [];
          for (const r of rowsRef.current.values()) {
            if (moving.has(r.id) || r.type === "stroke" || r.type === "place" || pageOf(r) !== page) continue;
            others.push(bounds(r));
          }
          const snap = snapBox({ ...box, x: box.x + dx, y: box.y + dy }, others, 8 / cam.current.zoom);
          dx += snap.sx;
          dy += snap.sy;
          setGuides(snap.guides);
        } else setGuides([]);
        preview(g.originals.map((r) => ({ id: r.id, row: { ...r, data: { ...r.data, x: Math.round(r.data.x + dx), y: Math.round(r.data.y + dy) } } })));
        setActivity({ k: "move", items: g.originals.slice(0, 150).map((r) => [r.id, Math.round(r.data.x + dx), Math.round(r.data.y + dy)]) });
        break;
      }
      case "resize": {
        const r = g.original;
        const b = bounds(r);
        const mode = RESIZABLE[r.type];
        const nw = Math.max(r.type === "window" ? 320 : 40, b.w + (w.x - g.wx));
        let nh = Math.max(r.type === "window" ? 160 : 30, b.h + (w.y - g.wy));
        const data: Partial<ElementData> = {};
        if (mode === "aspect") nh = (nw * b.h) / b.w;
        if (mode === "font") {
          data.size = Math.round(Math.max(10, Math.min(240, (r.data.size ?? 28) * (nw / b.w))));
        } else if (mode === "width") {
          data.w = Math.round(nw);
        } else {
          data.w = Math.round(nw);
          data.h = Math.round(nh);
        }
        preview([{ id: r.id, row: { ...r, data: { ...r.data, ...data } } }]);
        setActivity({ k: "resize", id: r.id, d: data });
        break;
      }
      case "erase":
        eraseAt(e.clientX, e.clientY, g);
        break;
      case "marquee": {
        const box = { x: Math.min(g.wx, w.x), y: Math.min(g.wy, w.y), w: Math.abs(w.x - g.wx), h: Math.abs(w.y - g.wy) };
        if (box.w * cam.current.zoom < 3 && box.h * cam.current.zoom < 3) break;
        setMarquee(box);
        setActivity({ k: "marquee", b: [Math.round(box.x), Math.round(box.y), Math.round(box.w), Math.round(box.h)] });
        const hit: string[] = [];
        for (const r of rowsRef.current.values()) {
          const b = bounds(r);
          // Touching is enough, except for places, which must be fully inside (they're big).
          const touches = b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y;
          if (r.type === "place" ? contains(box, b) : touches) hit.push(r.id);
        }
        setSelectedIds([...new Set([...g.base, ...hit])]);
        break;
      }
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size > 0 && g?.kind === "pinch") {
      // One finger left: continue as a pan from here.
      const [p] = [...pointers.current.values()];
      gesture.current = { kind: "pan", sx: p.x, sy: p.y, cam: { ...cam.current } };
      return;
    }
    gesture.current = null;
    if (!g) return;
    if (g.kind === "pan" && g.hold) clearTimeout(g.hold);
    switch (g.kind) {
      case "draw": {
        setDraft(null);
        const end = toWorld(e.clientX, e.clientY);
        const last = g.points[g.points.length - 1];
        if (Math.hypot(end.x - last[0], end.y - last[1]) > 0.5) g.points.push([end.x, end.y, last[2]]);
        if (g.points.length === 1) g.points.push([g.points[0][0] + 0.1, g.points[0][1] + 0.1, 0.5]);
        addRow("stroke", strokeData(g.points), false);
        endActivity();
        break;
      }
      case "shape": {
        const d = draftRef.current;
        setDraft(null);
        const big = d && (d.type === "arrow" ? Math.hypot(d.data.w ?? 0, d.data.h ?? 0) > 50 : (d.data.w ?? 0) > 6 && (d.data.h ?? 0) > 6);
        if (d && big) void send([{ before: null, after: { ...d, id: newId() } }]);
        endActivity(big ? 600 : 0);
        break;
      }
      case "move":
        setGuides([]);
        markDrop(null);
        if (g.moved && g.into && dropIntoWindow(g.originals, g.into)) {
          endActivity();
        } else if (g.moved) {
          void send(
            g.originals.map((r) => ({ before: committedRef.current.get(r.id) ?? r, after: rowsRef.current.get(r.id) ?? r })),
          );
          endActivity();
        }
        break;
      case "resize": {
        const after = rowsRef.current.get(g.original.id);
        if (after) void send([{ before: committedRef.current.get(after.id) ?? g.original, after }]);
        endActivity();
        break;
      }
      case "erase":
        if (g.originals.size) void send([...g.originals.values()].map((r) => ({ before: r, after: null })));
        endActivity();
        break;
      case "marquee":
        setMarquee(null);
        endActivity(0);
        break;
    }
  }

  function onDoubleClick(e: React.MouseEvent) {
    if (tool !== "select") return;
    const id = (e.target as HTMLElement).closest("[data-el]")?.getAttribute("data-el");
    const row = id ? rowsRef.current.get(id) : null;
    if (row && EDITABLE.includes(row.type)) setEditingId(row.id);
  }

  // Wheel: pinch-zoom on trackpads (ctrl) and ctrl/cmd+wheel zoom, plain wheel pans.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest(".dialog, .menu-panel")) return;
      // A plain scroll over a chat box's messages scrolls them (Ctrl+scroll still zooms).
      if (!e.ctrlKey && !e.metaKey && (e.target as HTMLElement).closest(".chatbox .chat-list, .chatbox .sticker-scroll")) return;
      // Same for a window someone made shorter than its blocks.
      const winBody = !e.ctrlKey && !e.metaKey ? (e.target as HTMLElement).closest<HTMLElement>(".win.fixed .win-body") : null;
      if (winBody && winBody.scrollHeight > winBody.clientHeight + 1) return;
      e.preventDefault();
      setFollowing(false);
      if (e.ctrlKey || e.metaKey) {
        // Lines/pages to pixels, so every mouse and browser behaves alike.
        const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
        if (Math.abs(dy) < 40) {
          // Trackpad pinch: many small deltas. Follow the fingers exactly.
          zoomAnim.current = null;
          zoomAt(e.clientX, e.clientY, cam.current.zoom * Math.exp(-dy * 0.01));
        } else {
          // Mouse wheel notch: 10% per notch, gliding there.
          const notches = Math.max(1, Math.round(Math.abs(dy) / 100));
          smoothZoomTo(zoomGoal() * Math.pow(dy > 0 ? 1 / 1.1 : 1.1, notches), e.clientX, e.clientY);
        }
      } else {
        const c = cam.current;
        setCamera({ ...c, x: c.x - (e.shiftKey ? e.deltaY : e.deltaX), y: c.y - (e.shiftKey ? 0 : e.deltaY) });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, setCamera, smoothZoomTo, zoomGoal]);

  /* ---------- Keyboard, paste, drop ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target) || dialog) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        stepZoom(1);
      } else if (mod && e.key === "-") {
        e.preventDefault();
        stepZoom(-1);
      } else if (mod && e.key === "0") {
        e.preventDefault();
        smoothZoomTo(1);
      } else if (e.shiftKey && !mod && e.code === "Digit1") {
        e.preventDefault();
        fitAll();
      } else if (e.shiftKey && !mod && e.code === "Digit2") {
        e.preventDefault();
        fitSelection();
      } else if (mod && e.key.toLowerCase() === "a" && !laneOpen) {
        e.preventDefault();
        setTool("select");
        setSelectedIds([...rowsRef.current.keys()]);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.length && !laneOpen) {
        e.preventDefault();
        deleteIds(selectedIds);
      } else if (e.key === "Escape") {
        setSelectedIds([]);
        setMenuOpen(false);
      } else if (e.key === " " && !e.repeat) {
        e.preventDefault();
        setSpaceHeld(true);
      } else if (!mod && !e.altKey && KEY_TOOLS[e.key.toLowerCase()] && !laneOpen) {
        chooseTool(KEY_TOOLS[e.key.toLowerCase()] as Tool);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceHeld(false);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target) || dialog || laneOpen) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        addFiles(files).catch((err) => showToast(err.message));
        return;
      }
      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (!text) return;
      e.preventDefault();
      const link = detectLink(text);
      if (link) addLink(link).catch((err) => showToast(err.message));
      else {
        const size = textSize;
        addRow("text", { ...placeNear(text.length * size * 0.5, size), text: text.slice(0, 5000), size, color: colorId, font: fontId });
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("paste", onPaste);
    };
  });

  /* ---------- Context for element views ---------- */
  const watchers = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const p of onlineHere) if (p.watching) (map[p.watching] ??= []).push(p.name);
    return map;
  }, [onlineHere]);
  const sendYt = useCallback(
    (elementId: string, cmd: Omit<YtCommand, "sentAt">) => {
      void sendSignal("yt", { elementId, ...cmd, sentAt: serverNow() }).catch(() => {});
    },
    [sendSignal, serverNow],
  );
  const onYt = useCallback((elementId: string, handler: (c: YtCommand) => void) => {
    const map = ytHandlers.current;
    if (!map.has(elementId)) map.set(elementId, new Set());
    map.get(elementId)!.add(handler);
    return () => {
      map.get(elementId)?.delete(handler);
    };
  }, []);
  const reportTyping = useCallback(
    (id: string, text: string) => {
      const row = rowsRef.current.get(id);
      if (row) setActivity({ k: "typing", id, text: text.slice(0, 3000), d: row.data });
    },
    [setActivity],
  );
  const finishText = useCallback(
    (id: string, text: string) => {
      if (editingRef.current !== id) return; // already finished
      setEditingId(null);
      endActivity();
      const row = rowsRef.current.get(id);
      if (!row) return;
      const clean = text.replace(/\n+$/, "");
      const before = committedRef.current.get(id) ?? null;
      if (!clean.trim()) {
        if (before) void send([{ before, after: null }]);
        else dropPreview(id);
        return;
      }
      if (before?.data.text === clean) return;
      void send([{ before, after: { ...row, data: { ...row.data, text: clean } } }]);
    },
    [send, dropPreview, setEditingId, endActivity],
  );
  // The context stays stable; this always calls the newest version.
  const moveBlockOutRef = useRef<(winId: string, blockId: string) => Promise<void>>(async () => {});
  useEffect(() => {
    moveBlockOutRef.current = moveBlockOut;
  });
  const ctx: BoardCtx = useMemo(
    () => ({
      boardId,
      me,
      readOnly: laneOpen,
      zoom: camera.zoom,
      watchers,
      serverNow,
      patch,
      finishText,
      reportTyping,
      chatFor: (thread) => threads.get(thread) ?? NO_CHAT,
      sendChat: sendTo,
      stopEditing: () => setEditingId(null),
      moveBlockOut: (winId, blockId) => void moveBlockOutRef.current(winId, blockId),
      startEditing: (id) => {
        setSelectedId(id);
        setEditingId(id);
      },
      sendYt,
      onYt,
      setWatching: setWatchingState,
      onListener,
      openCapsule: (id) => setDialog({ kind: "capsuleOpen", id, title: rowsRef.current.get(id)?.data.title || "Time capsule" }),
      addToCapsule: (id) => setDialog({ kind: "capsuleNote", id }),
    }),
    [boardId, me, laneOpen, camera.zoom, watchers, serverNow, patch, finishText, reportTyping, threads, sendTo, sendYt, onYt, onListener, setEditingId, setSelectedId],
  );

  /* ---------- Others' live activity ---------- */
  const remote = useMemo(() => {
    const override = new Map<string, Partial<ElementData>>();
    const marks = new Map<string, RemoteMark>();
    const drafts: { key: string; row: ElementRow; color: string }[] = [];
    const boxes: { key: string; b: [number, number, number, number]; color: string }[] = [];
    const selections: { key: string; ids: string[]; color: string; name: string }[] = [];
    const fake = (id: string, type: ElementType, data: ElementData): ElementRow => ({
      id, type, data, z: 1e6, created_by: null, created_at: new Date(0), updated_at: new Date(0),
    });
    for (const p of onlineHere) {
      const a = p.activity;
      if (!a) continue;
      const who = { color: p.color, name: p.name };
      switch (a.k) {
        case "select":
          selections.push({ key: p.user_id, ids: a.ids, ...who });
          break;
        case "marquee":
          boxes.push({ key: p.user_id, b: a.b, color: p.color });
          break;
        case "draw":
          if (a.pts?.length) {
            drafts.push({ key: p.user_id, color: p.color, row: fake(`live-${p.user_id}`, "stroke", { ...normalizePoints(a.pts, a.s), size: a.s, color: a.c }) });
          }
          break;
        case "shape":
          drafts.push({ key: p.user_id, color: p.color, row: fake(`live-${p.user_id}`, a.t, a.d) });
          break;
        case "move":
          for (const [id, x, y] of a.items) {
            override.set(id, { x, y });
            marks.set(id, { ...who, mode: "live" });
          }
          break;
        case "resize":
          override.set(a.id, a.d);
          marks.set(a.id, { ...who, mode: "live" });
          break;
        case "erase":
          for (const id of a.ids) marks.set(id, { ...who, mode: "erasing" });
          break;
        case "typing":
          if (rowsById.has(a.id)) override.set(a.id, { text: a.text });
          else drafts.push({ key: p.user_id, color: p.color, row: fake(a.id, "text", { ...a.d, text: a.text }) });
          marks.set(a.id, { ...who, mode: "typing" });
          break;
      }
    }
    return { override, marks, drafts, boxes, selections };
  }, [onlineHere, rowsById]);

  const ACTIVITY_VERB: Record<Activity["k"], string> = {
    select: "",
    marquee: " · selecting",
    draw: " · drawing",
    shape: " · drawing",
    move: " · moving",
    resize: " · resizing",
    typing: " · typing",
    erase: " · erasing",
  };

  /* ---------- Render ---------- */
  // Others' drags and typing show on top of the saved rows (my own changes win).
  const liveRows = remote.override.size
    ? rows.map((r) => {
        const o = remote.override.get(r.id);
        return o && !overlay.has(r.id) ? { ...r, data: { ...r.data, ...o } } : r;
      })
    : rows;
  const displayRows = laneOpen ? (laneRows ?? []).filter((r) => pageOf(r) === page) : liveRows;
  // Where things are on screen right now, including others' drags (for their selection outlines).
  const liveById = liveRows === rows ? rowsById : new Map(liveRows.map((r) => [r.id, r]));
  const placesLayer = displayRows.filter((r) => r.type === "place");
  const contentLayer = displayRows.filter((r) => r.type !== "place");
  const selectedRows = laneOpen ? [] : selectedIds.map((id) => rowsById.get(id)).filter((r): r is ElementRow => !!r);
  const selected = selectedRows.length === 1 ? selectedRows[0] : null;
  const stylable = selectedRows.filter((r) => STYLABLE.includes(r.type));
  const showStyle = !laneOpen && (DRAW_TOOLS.includes(tool) || (tool === "select" && stylable.length > 0));
  const activeColor = tool === "select" && stylable[0]?.data.color ? stylable[0].data.color : colorId;
  const selectedTexts = selectedRows.filter((r) => r.type === "text");
  const showFonts = !laneOpen && (tool === "text" || (tool === "select" && selectedTexts.length > 0));
  const activeFont = tool === "select" && selectedTexts[0] ? selectedTexts[0].data.font ?? "clean" : fontId;
  const activeTextSize = tool === "select" && selectedTexts[0] ? selectedTexts[0].data.size ?? 28 : textSize;
  const status = sync.status;
  const selBox = selectedRows.length ? unionBounds(selectedRows) : null;
  const iLike = selectedRows.length > 0 && selectedRows.every((r) => r.data.likes?.includes(me.id));

  function applyStyle(next: { color?: string; size?: number; font?: string; fontSize?: number }) {
    if (next.color) setColorId(next.color);
    if (next.size) setSizeId(next.size);
    if (next.font) setFontId(next.font);
    if (next.fontSize) setTextSize(next.fontSize);
    // The thin/medium/bold buttons also set the size of new text.
    else if (next.size && tool === "text") setTextSize(TEXT_SIZES[next.size - 1]);
    if (tool !== "select" || !stylable.length) return;
    const changes = stylable.flatMap((r) => {
      const data: Partial<ElementData> = {};
      if (next.color) data.color = next.color;
      if (next.font && r.type === "text") data.font = next.font;
      if (next.fontSize && r.type === "text") data.size = next.fontSize;
      if (next.size) {
        if (r.type === "text") data.size = TEXT_SIZES[next.size - 1];
        else if (r.type !== "stroke") data.size = SHAPE_WIDTHS[next.size - 1]; // stroke width is baked into its shape
      }
      if (!Object.keys(data).length) return [];
      return [{ before: committedRef.current.get(r.id) ?? r, after: { ...r, data: { ...r.data, ...data } } }];
    });
    void send(changes);
  }

  const alignOpen = alignFor === selectedIds.join();
  /** The window under the pointer that dragged items would drop into, skipping the items themselves. */
  function windowDropAt(x: number, y: number, moving: ElementRow[]): DropInto | null {
    const skip = new Set(moving.map((r) => r.id));
    for (const node of document.elementsFromPoint(x, y)) {
      const host = (node as HTMLElement).closest<HTMLElement>("[data-el]");
      if (!host) {
        if ((node as HTMLElement).closest(".board-root")) return null;
        continue;
      }
      if (skip.has(host.dataset.el!)) continue;
      if (host.dataset.type !== "window") return null;
      return { winId: host.dataset.el!, blockId: (node as HTMLElement).closest<HTMLElement>("[data-block]")?.dataset.block ?? null };
    }
    return null;
  }
  /** Highlights where a drop would land. Set straight on the page so dragging stays smooth. */
  function markDrop(t: DropInto | null | undefined) {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll("[data-drop-into]").forEach((n) => n.removeAttribute("data-drop-into"));
    root.querySelectorAll("[data-drop-here]").forEach((n) => n.removeAttribute("data-drop-here"));
    if (!t) return;
    const host = root.querySelector(`[data-el="${t.winId}"]`);
    host?.setAttribute("data-drop-into", "");
    if (t.blockId) host?.querySelector(`[data-block="${t.blockId}"]`)?.setAttribute("data-drop-here", "");
  }
  /** Turns dragged items into blocks of a window: one change, so a single undo puts them back. */
  function dropIntoWindow(items: ElementRow[], t: DropInto) {
    const win = rowsRef.current.get(t.winId);
    const added = items.map(blockFromElement);
    if (!win || win.type !== "window" || added.some((b) => !b)) return false;
    const blocks = insertBlocks(win.data.blocks ?? [], added as WinBlock[], t.blockId);
    void send([
      ...items.map((r) => ({ before: committedRef.current.get(r.id) ?? r, after: null })),
      { before: committedRef.current.get(win.id) ?? win, after: { ...win, data: { ...win.data, blocks }, updated_at: new Date() } },
    ]);
    setSelectedId(win.id);
    return true;
  }
  async function moveBlockOut(winId: string, blockId: string) {
    const win = rowsRef.current.get(winId);
    const block = win?.data.blocks?.find((b) => b.id === blockId);
    const made = block && elementFromBlock(block);
    if (!win || !block || !made) return;
    const data: ElementData = { ...made.data, x: 0, y: 0, page: win.data.page };
    if (made.type === "image" && data.src) {
      const size = await imageSize(data.src).catch(() => null);
      if (size) Object.assign(data, fitWithin(size.w, size.h, 320));
    }
    // Beside the window, at the height of the block.
    const wb = bounds(win);
    const blockEl = rootRef.current?.querySelector<HTMLElement>(`[data-el="${winId}"] [data-block="${blockId}"]`);
    const winEl = rootRef.current?.querySelector<HTMLElement>(`[data-el="${winId}"]`);
    const offset = blockEl && winEl ? (blockEl.getBoundingClientRect().top - winEl.getBoundingClientRect().top) / cam.current.zoom : 0;
    data.x = Math.round(wb.x + wb.w + 40);
    data.y = Math.round(wb.y + offset);
    const row = { ...mkRow(made.type, data, nextZ(), me.id), ...(made.id ? { id: made.id } : {}) };
    const latest = rowsRef.current.get(winId) ?? win;
    void send([
      { before: committedRef.current.get(winId) ?? latest, after: { ...latest, data: { ...latest.data, blocks: (latest.data.blocks ?? []).filter((b) => b.id !== blockId) }, updated_at: new Date() } },
      { before: null, after: row },
    ]);
  }

  /** Lines up the selected items, or spaces them evenly, moving each by whole units. */
  function alignSelection(how: AlignKind) {
    const items = selectedRows.map((r) => ({ r, b: bounds(r) }));
    if (items.length < 2) return;
    const box = unionBounds(selectedRows)!;
    const target = new Map<string, { x: number; y: number }>();
    for (const { r, b } of items) {
      let { x, y } = b;
      if (how === "left") x = box.x;
      if (how === "center") x = box.x + box.w / 2 - b.w / 2;
      if (how === "right") x = box.x + box.w - b.w;
      if (how === "top") y = box.y;
      if (how === "middle") y = box.y + box.h / 2 - b.h / 2;
      if (how === "bottom") y = box.y + box.h - b.h;
      target.set(r.id, { x, y });
    }
    if (how === "across" || how === "down") {
      const across = how === "across";
      const sorted = [...items].sort((p, q) => (across ? p.b.x - q.b.x : p.b.y - q.b.y));
      const total = sorted.reduce((s, it) => s + (across ? it.b.w : it.b.h), 0);
      // Even gaps between neighbours; if they overlap, give them a small gap instead.
      const gap = Math.max(24, ((across ? box.w : box.h) - total) / (sorted.length - 1));
      let at = across ? box.x : box.y;
      for (const it of sorted) {
        target.set(it.r.id, across ? { x: at, y: it.b.y } : { x: it.b.x, y: at });
        at += (across ? it.b.w : it.b.h) + gap;
      }
    }
    changeAll((r) => {
      const b = bounds(r);
      const t = target.get(r.id)!;
      return { ...r, data: { ...r.data, x: Math.round(r.data.x + t.x - b.x), y: Math.round(r.data.y + t.y - b.y) } };
    });
  }

  function changeAll(fn: (r: ElementRow) => ElementRow) {
    void send(selectedRows.map((r) => ({ before: committedRef.current.get(r.id) ?? r, after: fn(r) })));
  }

  function fitAll() {
    zoomAnim.current = null;
    const all = unionBounds(rows);
    if (all) flyTo(cameraFor(all, window.innerWidth, window.innerHeight));
    else flyTo({ x: window.innerWidth / 2, y: window.innerHeight / 2, zoom: 1 });
  }

  function fitSelection() {
    const box = selectedRows.length ? unionBounds(selectedRows) : null;
    if (!box) return;
    zoomAnim.current = null;
    flyTo(cameraFor(box, window.innerWidth, window.innerHeight));
  }

  return (
    <BoardContext.Provider value={ctx}>
      {sync.nodes}
      <div
        ref={rootRef}
        className={`board-root tool-${laneOpen ? "hand" : tool}${spaceHeld ? " panning" : ""}${laneOpen ? " replay" : ""}`}
        style={{
          ["--sel" as string]: me.color,
          backgroundSize: `${22 * camera.zoom}px ${22 * camera.zoom}px`,
          backgroundPosition: `${camera.x}px ${camera.y}px`,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(e) => {
          // A finger lifting also "leaves". Keep showing where they last touched instead.
          if (e.pointerType !== "mouse") return;
          lastCursor.current = null;
          schedulePresence();
        }}
        onDoubleClick={onDoubleClick}
        onDragOver={(e) => {
          if (laneOpen || !e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={(e) => e.target === e.currentTarget && setDropping(false)}
        onDrop={(e) => {
          setDropping(false);
          if (laneOpen) return;
          e.preventDefault();
          const files = Array.from(e.dataTransfer.files);
          if (files.length) addFiles(files, toWorld(e.clientX, e.clientY)).catch((err) => showToast(err.message));
          else {
            const link = detectLink(e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain"));
            if (link) addLink(link, toWorld(e.clientX, e.clientY)).catch((err) => showToast(err.message));
          }
        }}
      >
        <div className="world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
          {placesLayer.map((r) => (
            <ElementView key={r.id} row={r} selected={selectedSet.has(r.id) && !laneOpen} solo={r.id === selectedId} editing={false} likes={0} />
          ))}
          {contentLayer.map((r) => (
            <ElementView
              key={r.id}
              row={r}
              selected={selectedSet.has(r.id) && !laneOpen}
              solo={r.id === selectedId}
              editing={r.id === editingId && !laneOpen}
              likes={r.data.likes?.length ?? 0}
              remote={laneOpen ? undefined : remote.marks.get(r.id)}
            />
          ))}
          {!laneOpen && (
            <div className="remote-layer" aria-hidden="true">
              {remote.selections.flatMap((s) =>
                s.ids.slice(0, 60).flatMap((id, i) => {
                  const r = liveById.get(id);
                  if (!r) return [];
                  const b = bounds(r);
                  const pad = 6 / camera.zoom;
                  return [
                    <div
                      key={`${s.key}-${id}`}
                      className="remote-sel"
                      style={{ left: b.x - pad, top: b.y - pad, width: b.w + pad * 2, height: b.h + pad * 2, borderWidth: 1.5 / camera.zoom, ["--rc" as string]: s.color }}
                    >
                      {i === 0 && (
                        <span className="remote-sel-name" style={{ background: s.color, color: textOn(s.color), transform: `scale(${1 / camera.zoom})` }}>
                          {s.name}
                        </span>
                      )}
                    </div>,
                  ];
                }),
              )}
              {remote.boxes.map((m) => (
                <div
                  key={m.key}
                  className="remote-marquee"
                  style={{ left: m.b[0], top: m.b[1], width: m.b[2], height: m.b[3], borderWidth: 1.5 / camera.zoom, ["--rc" as string]: m.color }}
                />
              ))}
              {remote.drafts.map((d) =>
                d.row.type === "stroke" ? (
                  <div key={d.key} className="el el-stroke remote-draft" style={{ left: d.row.data.x, top: d.row.data.y, width: d.row.data.w, height: d.row.data.h }}>
                    <StrokeSvg row={d.row} />
                  </div>
                ) : (
                  <ElementView key={d.key} row={d.row} selected={false} editing={false} likes={0} remote={d.row.type === "text" ? remote.marks.get(d.row.id) : undefined} />
                ),
              )}
            </div>
          )}
          {draft?.type === "stroke" && (
            <div className="el el-stroke" style={{ left: draft.data.x, top: draft.data.y, width: draft.data.w, height: draft.data.h, zIndex: 999999 }}>
              <StrokeSvg row={draft} />
            </div>
          )}
          {draft && draft.type !== "stroke" && <ElementView row={draft} selected={false} editing={false} likes={0} />}
          {guides.map((gd, i) => (
            <div
              key={i}
              className="snap-guide"
              style={
                gd.axis === "x"
                  ? { left: gd.at - 0.5 / camera.zoom, top: gd.from, width: 1 / camera.zoom, height: gd.to - gd.from }
                  : { left: gd.from, top: gd.at - 0.5 / camera.zoom, width: gd.to - gd.from, height: 1 / camera.zoom }
              }
            />
          ))}
          {marquee && (
            <div
              className="marquee"
              style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, borderWidth: 1.5 / camera.zoom }}
            />
          )}
          {!marquee && selectedRows.length > 1 && selBox && (
            <div
              className="group-box"
              style={{ left: selBox.x - 8 / camera.zoom, top: selBox.y - 8 / camera.zoom, width: selBox.w + 16 / camera.zoom, height: selBox.h + 16 / camera.zoom, borderWidth: 1.5 / camera.zoom }}
            />
          )}
          {!laneOpen &&
            onlineHere.map((p) =>
              p.cursor_x == null || p.cursor_y == null ? null : (
                <RemoteCursor
                  key={p.user_id}
                  x={p.cursor_x}
                  y={p.cursor_y}
                  zoom={camera.zoom}
                  color={p.color}
                  label={`${p.name}${p.activity ? ACTIVITY_VERB[p.activity.k] : ""}`}
                />
              ),
            )}
        </div>

        {dropping && <div className="drop-hint">Drop to add to the board</div>}
      </div>

      {!laneOpen &&
        edgeMarkers.map((m) => (
          <button
            key={m.p.user_id}
            type="button"
            className="edge-marker"
            style={{ left: m.x, top: m.y, ["--c" as string]: m.p.color, color: textOn(m.p.color) }}
            aria-label={`Go to ${m.p.name}`}
            title={`${m.p.name} is over here · tap to go`}
            onClick={() => {
              setFollowId(null);
              const z = cam.current.zoom;
              flyTo({ zoom: z, x: window.innerWidth / 2 - m.wx * z, y: window.innerHeight / 2 - m.wy * z });
            }}
          >
            <span className="edge-arrow" style={{ transform: `rotate(${m.angle}rad)` }} aria-hidden="true" />
            <span className="edge-name">{m.p.name}</span>
          </button>
        ))}

      <input ref={keyboardProxy} className="keyboard-proxy" aria-hidden="true" tabIndex={-1} />

      {/* Hearts float over everything. */}
      <div className="hearts" style={{ left: 0, top: 0 }} aria-hidden="true">
        {hearts.map((h) => (
          <div
            key={h.id}
            className="heart-float"
            style={{ left: h.x - 11, top: h.y - 11, animationDelay: `${h.delay}ms`, ["--dx" as string]: `${h.dx}px` }}
          >
            <Icon name="wave" size={24} />
          </div>
        ))}
      </div>

      {selectedRows.length > 0 && selBox && !marquee && tool === "select" && !editingId && (
        <div
          className="sel-toolbar surface"
          style={{ left: (selBox.x + selBox.w / 2) * camera.zoom + camera.x, top: Math.max(80, selBox.y * camera.zoom + camera.y) }}
        >
          <button
            type="button"
            className="icon-btn sm"
            aria-label={iLike ? "Unlike" : selectedRows.length > 1 ? `Like all ${selectedRows.length}` : "Like"}
            aria-pressed={iLike}
            style={iLike ? { color: "var(--accent)", background: "var(--accent-soft)" } : undefined}
            onClick={() =>
              changeAll((r) => {
                const likes = (r.data.likes ?? []).filter((l) => l !== me.id);
                return { ...r, data: { ...r.data, likes: iLike ? likes : [...likes, me.id] } };
              })
            }
          >
            <Icon name="heart" size={18} filled={iLike} />
          </button>
          {selectedRows.length > 1 && <span className="sel-count">{selectedRows.length} selected</span>}
          {selectedRows.length > 1 && (
            <div className="align-wrap">
              <button
                type="button"
                className="icon-btn sm"
                aria-label="Align"
                title="Align and space out"
                aria-expanded={alignOpen}
                onClick={() => setAlignFor(alignOpen ? null : selectedIds.join())}
              >
                <Icon name="alignLeft" size={18} />
              </button>
              {alignOpen && (
                <div className="align-pop surface" role="toolbar" aria-label="Align selection">
                  {ALIGN_ACTIONS.filter((a) => !a.spread || selectedRows.length > 2).map((a, i, all) => (
                    <Fragment key={a.id}>
                      {i > 0 && all[i - 1].group !== a.group && <span className="align-sep" />}
                      <button type="button" className="icon-btn sm" aria-label={a.label} title={a.label} onClick={() => alignSelection(a.id)}>
                        <Icon name={a.icon} size={18} />
                      </button>
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          )}
          {selected && EDITABLE.includes(selected.type) && (
            <button
              type="button"
              className="icon-btn sm"
              aria-label="Edit"
              onClick={(e) => {
                // A tap reports as a click without a mouse; open the phone keyboard then.
                primeKeyboard((e.nativeEvent as PointerEvent).pointerType || "mouse");
                setEditingId(selected.id);
              }}
            >
              <Icon name="pen" size={18} />
            </button>
          )}
          <button
            type="button"
            className="icon-btn sm"
            aria-label="Bring to front"
            onClick={() => {
              let z = nextZ();
              changeAll((r) => ({ ...r, z: z++ }));
            }}
          >
            <Icon name="front" size={18} />
          </button>
          <button type="button" className="icon-btn sm" aria-label={selectedRows.length > 1 ? `Delete ${selectedRows.length} items` : "Delete"} onClick={() => deleteIds(selectedIds)}>
            <Icon name="trash" size={18} />
          </button>
        </div>
      )}

      {laneOpen ? (
        <MemoryLane
          boardId={boardId}
          partnerName={others.length === 1 ? others[0].name : null}
          theme={theme}
          onToggleTheme={toggleTheme}
          onRows={setLaneRows}
          onClose={() => {
            setLaneOpen(false);
            setLaneRows(null);
          }}
        />
      ) : (
        <>
          <div className="hud topbar">
            <div className="topbar-left">
              <div className="pill" style={{ paddingRight: 14 }}>
                <button type="button" className="icon-btn" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
                  <Icon name="menu" />
                </button>
                <div className="brand">
                  <span className="brand-mark" aria-hidden="true" />
                  <span className="room-name">{board?.name || "Untitled room"}</span>
                </div>
              </div>
              <PagesBar
                pages={pages}
                current={page}
                count={rows.length}
                onSwitch={switchPage}
                onAdd={addPage}
                onRename={(id, name) => savePages(pages.map((p) => (p.id === id ? { ...p, name } : p)))}
                onDelete={deletePage}
                onClear={clearPage}
              />
              <button type="button" className="pill code-chip" onClick={copyInvite} title="Copy the invite link" aria-label={`Room code ${displayCode(boardId)}. Copy the invite link`}>
                <span className="code-label">Code</span>
                <span className="mono">{displayCode(boardId)}</span>
                <Icon name="link" size={16} />
              </button>
              <nav className="pill places" aria-label="Places">
                <button type="button" className="place-btn" aria-current={!myPlace} onClick={fitAll}>
                  All
                </button>
                {places.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="place-btn"
                    aria-current={myPlace?.id === p.id}
                    onClick={() => flyTo(cameraFor(bounds(p), window.innerWidth, window.innerHeight, 80))}
                  >
                    {p.data.name}
                  </button>
                ))}
                <button type="button" className="icon-btn sm" aria-label="Add a place" onClick={() => setDialog({ kind: "place" })}>
                  <Icon name="plus" size={16} />
                </button>
              </nav>
            </div>

            <div className="topbar-right">
              <div className="pill partner">
                <div className="partner-avatars">
                  <span className="avatar" title={`${me.name} (you)`} style={{ background: me.color, color: textOn(me.color) }}>
                    {initials(me.name)}
                  </span>
                  {online.length > 0 ? (
                    <div className="people">
                      {online.slice(0, 4).map((p) => (
                        <button
                          key={p.user_id}
                          type="button"
                          className="person"
                          aria-label={followId === p.user_id ? `Stop following ${p.name}` : `Follow ${p.name}'s view`}
                          aria-pressed={followId === p.user_id}
                          title={`${p.name}${placeOf(p) ? ` · in ${placeOf(p)!.data.name}` : ""} · click to follow`}
                          onClick={() => setFollowId((id) => (id === p.user_id ? null : p.user_id))}
                        >
                          <span className="avatar online-ring" style={{ background: p.color, color: textOn(p.color) }}>
                            {initials(p.name)}
                          </span>
                        </button>
                      ))}
                      {online.length > 4 && <span className="avatar more" title={online.slice(4).map((p) => p.name).join(", ")}>+{online.length - 4}</span>}
                    </div>
                  ) : partner ? (
                    <span className="avatar" title={partner.name} style={{ background: partner.color, color: textOn(partner.color), opacity: 0.55 }}>
                      {initials(partner.name)}
                    </span>
                  ) : (
                    <span className="avatar" style={{ background: "var(--border-strong)" }}>?</span>
                  )}
                </div>
                <div className="partner-text">
                  <strong>
                    {online.length > 1
                      ? `${online.slice(0, 2).map((p) => p.name).join(", ")}${online.length > 2 ? ` +${online.length - 2}` : ""} are here`
                      : online.length === 1
                        ? partnerPlace
                          ? `${online[0].name} is in ${partnerPlace.data.name}`
                          : `${online[0].name} is here`
                        : partner
                          ? `${partner.name} was here ${relativeTime(partner.updated_at, now)}`
                          : "Just you so far"}
                  </strong>
                  <span>{online.length ? `${online.length + 1} in this room` : `Share code ${displayCode(boardId)} to invite`}</span>
                </div>
                <button type="button" className="icon-btn heart-btn" aria-label="Wave at everyone in the room" title="Wave" onClick={sendWave}>
                  <Icon name="wave" />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={followActive ? `Stop following ${followed!.name}` : `Follow ${online[0]?.name ?? "their"} view`}
                  title={followActive ? `Following ${followed!.name}` : partnerOnline ? `Follow ${online[0].name}'s view (or click anyone's avatar)` : "Nobody else is here right now"}
                  aria-pressed={followActive}
                  disabled={!partnerOnline}
                  onClick={() => setFollowId(followActive ? null : online[0]?.user_id ?? null)}
                >
                  <Icon name="eye" />
                </button>
              </div>
              <button
                type="button"
                className="icon-btn surface theme-btn"
                aria-label={theme === "dark" ? "Switch to day" : "Switch to night"}
                title={theme === "dark" ? "Switch to day" : "Switch to night"}
                onClick={toggleTheme}
              >
                <Icon name={theme === "dark" ? "sun" : "moon"} />
              </button>
            </div>
          </div>

          {menuOpen && (
            <div className="menu-panel surface">
              <h3>Room</h3>
              <div>
                <label className="field-label" htmlFor="board-name">
                  Name
                </label>
                <input
                  id="board-name"
                  className="input"
                  defaultValue={board?.name}
                  key={board?.name}
                  maxLength={80}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== board?.name) api.updateBoard(boardId, { name, from: me.id }).then(setBoard, () => showToast("Couldn't rename"));
                  }}
                />
              </div>
              <div>
                <span className="field-label">Invite code</span>
                <button type="button" className="btn code-big" onClick={copyInvite}>
                  <span className="mono">{displayCode(boardId)}</span>
                  <span className="muted">Copy link</span>
                </button>
              </div>
              <Link className="btn" href="/" style={{ justifyContent: "flex-start" }}>
                <Icon name="back" size={18} /> All rooms
              </Link>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={proximityOn}
                  onChange={(e) => {
                    setProximityOn(e.target.checked);
                    try {
                      localStorage.setItem("drawory:proximity", e.target.checked ? "on" : "off");
                    } catch {}
                  }}
                />
                <span>
                  <strong>Proximity audio</strong>
                  <span className="muted">Videos and voice notes get quieter the further you are from them.</span>
                </span>
              </label>
              <h3>You</h3>
              <button type="button" className="btn" style={{ justifyContent: "flex-start" }} onClick={() => setDialog({ kind: "me" })}>
                <span className="avatar" style={{ background: me.color, width: 26, height: 26 }}>
                  {initials(me.name)}
                </span>
                {me.name} · change
              </button>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                Shortcuts: V select · H pan · P draw · E erase · T text · N list · Space+drag pan · Ctrl+Z undo
              </p>
            </div>
          )}

          <div className="hud bottombar">
            <div className="bottom-left">
              <div className="ctrl-group">
                <button type="button" className="icon-btn sm" aria-label="Undo" onClick={undo}>
                  <Icon name="undo" size={18} />
                </button>
                <button type="button" className="icon-btn sm" aria-label="Redo" onClick={redo}>
                  <Icon name="redo" size={18} />
                </button>
                <div className="ctrl-sep" />
                <ZoomControl
                  zoom={camera.zoom}
                  onSet={(z) => {
                    zoomAnim.current = null;
                    zoomAt(window.innerWidth / 2, window.innerHeight / 2, z);
                  }}
                  onGlide={(z) => smoothZoomTo(z)}
                  onStep={(d) => stepZoom(d)}
                  onFitAll={fitAll}
                  onFitSelection={selectedRows.length ? fitSelection : null}
                />
              </div>
            </div>

            <div className="dock-wrap">
              {stickersOpen && (
                <StickerTray
                  onClose={() => setStickersOpen(false)}
                  onPick={(s) => {
                    setStickersOpen(false);
                    void addSticker(s);
                  }}
                />
              )}
              {showStyle && !stickersOpen && (
                <div className="style-bar" role="group" aria-label="Style">
                  {STROKE_COLORS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="swatch"
                      aria-label={c.label}
                      aria-pressed={activeColor === c.id}
                      style={{ background: c.value }}
                      onClick={() => applyStyle({ color: c.id })}
                    />
                  ))}
                  <div className="ctrl-sep" />
                  {STROKE_SIZES.map((s) => (
                    <button key={s.id} type="button" className="width-btn" aria-label={s.label} aria-pressed={sizeId === s.id} onClick={() => applyStyle({ size: s.id })}>
                      <span style={{ height: s.id * 2 }} />
                    </button>
                  ))}
                  {showFonts && (
                    <>
                      <div className="ctrl-sep" />
                      <div className="font-group" role="group" aria-label="Font">
                        {FONTS.map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            className="font-btn"
                            aria-label={`${f.label} font`}
                            title={f.label}
                            aria-pressed={activeFont === f.id}
                            style={{ fontFamily: f.css }}
                            onClick={() => applyStyle({ font: f.id })}
                          >
                            Aa
                          </button>
                        ))}
                      </div>
                      <div className="ctrl-sep" />
                      <TextSizeControl size={activeTextSize} onChange={(s) => applyStyle({ fontSize: s })} />
                    </>
                  )}
                </div>
              )}
              <div className="dock" role="toolbar" aria-label="Tools">
                {TOOL_GROUPS.map((group, gi) => (
                  <div key={gi} style={{ display: "contents" }}>
                    {gi > 0 && <div className="dock-sep" />}
                    {group.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="tool-btn"
                        aria-label={t.label}
                        title={t.key ? `${t.label} (${t.key.toUpperCase()})` : t.label}
                        aria-pressed={t.id === "sticker" ? stickersOpen : tool === t.id}
                        data-sticker-toggle={t.id === "sticker" ? "" : undefined}
                        onClick={() => chooseTool(t.id)}
                      >
                        <Icon name={t.icon} />
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="bottom-right">
              <NowPlaying items={nowPlaying} onJump={jumpToElement} />
              <button
                type="button"
                className="status-pill"
                role="status"
                disabled={status === "live"}
                title={`${STATUS[status].title}. ${sock.connected ? "Cursors and live activity: instant (relay connected)." : "Cursors and live activity: through the database (relay not reachable)."}`}
                aria-label={`${STATUS[status].label}. ${STATUS[status].title}`}
                onClick={sync.reconnect}
              >
                <span className={`dot ${status}`} />
                <span className="status-text">{STATUS[status].label}</span>
              </button>
              <button type="button" className="lane-btn" onClick={() => setLaneOpen(true)}>
                <Icon name="history" size={18} />
                <span>Replay</span>
              </button>
            </div>
          </div>
        </>
      )}

      {toast && (
        <div className="toast" role="status" key={toast.id}>
          {toast.heart && <Icon name="wave" size={18} style={{ color: "var(--accent)" }} />}
          {toast.text}
          {toast.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.action!.run();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      )}

      {dialog?.kind === "media" && (
        <AddMediaDialog initialUrl={dialog.url} onClose={() => setDialog(null)} onAddLink={(d) => addLink(d)} onAddFiles={(f) => addFiles(f)} />
      )}
      {dialog?.kind === "voice" && <VoiceDialog onClose={() => setDialog(null)} onAdd={addVoice} />}
      {dialog?.kind === "capsule" && <CapsuleDialog onClose={() => setDialog(null)} onSeal={sealCapsule} />}
      {dialog?.kind === "capsuleNote" && (
        <CapsuleNoteDialog
          onClose={() => setDialog(null)}
          onAdd={async (body) => {
            const res = await api.addToCapsule(boardId, dialog.id, { body, author: me.id, authorName: me.name });
            if (res.txid) await awaitTxId(res.txid);
            showToast("Sealed inside. See you on the day.");
          }}
        />
      )}
      {dialog?.kind === "capsuleOpen" && (
        <CapsuleOpenDialog boardId={boardId} elementId={dialog.id} title={dialog.title} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "place" && <PlaceDialog onClose={() => setDialog(null)} onCreate={createPlace} />}
      {dialog?.kind === "me" && (
        <SetupDialog
          initial={me}
          onCancel={() => setDialog(null)}
          onDone={(next) => {
            onChangeMe(next);
            setDialog(null);
          }}
        />
      )}
    </BoardContext.Provider>
  );

}
