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
  attachArrows,
  isArea,
  ATTACHABLE,
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
import type { FocusState, Listening } from "@/lib/types";
import type { Activity, BoardMeta, BoardPage, ChatRow, ElementData, ElementOp, ElementRow, ElementType, PresenceRow, WinBlock } from "@/lib/types";
import { applyEdit, type Edit } from "@/lib/edits";
import { PagesBar } from "./PagesBar";
import { NowPlaying, type PlayingItem } from "./NowPlaying";
import { BoardContext, type BoardCtx, type Unread, type YtCommand } from "./context";
import { mentions } from "@/lib/reactions";
import {
  cardIdFrom,
  connectSpotify,
  forgetSpotify,
  setSharingSpotify,
  setSpotifyCard,
  sharingSpotify,
  spotifyCard,
  spotifyKey,
  takeSpotifyReturn,
} from "@/lib/client/spotify";
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
import { SearchPanel, type SearchHit } from "./SearchPanel";
import { Minimap } from "./Minimap";
import { FocusTimer } from "./FocusTimer";
import { formatVideoTime, videoTime } from "@/lib/client/videoTimes";
import { recordTimelapse } from "@/lib/client/timelapse";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { SummonBanner } from "./SummonBanner";
import { EmojiMaker } from "./EmojiMaker";
import { recognize, sampleSegments, snapAngle, type Recognized } from "@/lib/client/shapes";
import { densify, eraseFromStroke, inPolygon } from "@/lib/client/erase";
import { mirrorTransforms, transformData, type MirrorMode } from "@/lib/client/mirror";
import { LaserLayer } from "./LaserLayer";
import { deleteTemplate, saveTemplate, useTemplates } from "@/lib/client/templates";
import { PhotoEditor } from "./PhotoEditor";
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
  | "hand" | "select" | "lasso" | "pen" | "eraser" | "laser" | "rect" | "ellipse" | "arrow" | "text"
  | "note" | "sticky" | "sticker" | "chatbox" | "window" | "game" | "media" | "youtube" | "voice" | "capsule";

/** edit: a small change the server applies to its newest copy (votes, ticks), not a whole-card save. */
type Change = { before: ElementRow | null; after: ElementRow | null; edit?: Edit };

type Gesture =
  // hold: on touch, keeping a finger still on empty canvas turns the pan into a selection box.
  | { kind: "pan"; sx: number; sy: number; cam: Camera; hold?: ReturnType<typeof setTimeout> }
  | { kind: "pinch"; d0: number; mx: number; my: number; cam: Camera }
  // hold: the timer that straightens the stroke when the pen rests; snapped: the clean shape it became.
  | { kind: "draw"; points: number[][]; hold?: ReturnType<typeof setTimeout>; snapped?: Recognized | null; straight?: boolean }
  | { kind: "shape"; type: "rect" | "ellipse" | "arrow"; ox: number; oy: number }
  | { kind: "move"; wx: number; wy: number; originals: ElementRow[]; moved: boolean; canDrop: boolean; into?: DropInto | null; samples?: number[][] }
  | { kind: "resize"; wx: number; wy: number; original: ElementRow }
  | { kind: "erase"; originals: Map<string, ElementRow> }
  | { kind: "laser"; pts: number[][] }
  | { kind: "rotate"; original: ElementRow; cx: number; cy: number }
  | { kind: "lasso"; pts: number[][] }
  | { kind: "erasePart"; path: number[][]; touched: Map<string, ElementRow>; temp: Map<string, string[]> }
  | { kind: "marquee"; wx: number; wy: number; base: string[] };

const TOOL_GROUPS: { id: Tool; label: string; icon: IconName; key?: string }[][] = [
  [
    { id: "hand", label: "Pan", icon: "hand", key: "h" },
    { id: "select", label: "Select", icon: "select", key: "v" },
    { id: "lasso", label: "Lasso select", icon: "lasso", key: "l" },
  ],
  [
    { id: "pen", label: "Draw", icon: "pen", key: "p" },
    { id: "eraser", label: "Eraser", icon: "eraser", key: "e" },
    { id: "laser", label: "Laser pointer", icon: "laser", key: "k" },
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
    { id: "game", label: "Pictionary area", icon: "game", key: "g" },
    { id: "media", label: "Photo, video or link", icon: "image" },
    { id: "youtube", label: "Watch together", icon: "youtube" },
    { id: "voice", label: "Voice note", icon: "mic" },
    { id: "capsule", label: "Time capsule", icon: "capsule" },
  ],
];
/** A window (and the block in it) that dragged items will drop into. */
type DropInto = { winId: string; blockId: string | null };

type ShapeFill = "none" | "soft" | "solid";

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
/** Resting the pen this long turns the stroke into a straight line or a clean shape. */
const HOLD_TO_STRAIGHTEN_MS = 550;
/** Fading ink lasts this long. */
const FADE_MS = 12_000;
const STATUS: Record<SyncStatus, { label: string; title: string }> = {
  live: { label: "Live", title: "Everyone's changes and cursors appear instantly" },
  polling: { label: "Synced", title: "The instant connection isn't available here, so the board syncs every second. Tap to retry." },
  connecting: { label: "Connecting…", title: "Connecting to the board" },
  offline: { label: "Offline", title: "Can't reach the board right now. Tap to retry." },
};

/** Board items on the clipboard are text with this prefix, so they paste back as items (in any room). */
const CLIP_PREFIX = "drawory-items:";
const DEFAULT_PAGES: BoardPage[] = [{ id: "main", name: "Page 1" }];
const pageOf = (r: { data: ElementData }) => r.data.page ?? "main";
const NO_CHAT: readonly ChatRow[] = [];
/** What can be turned into an emoji. */
const EMOJI_TYPES: ElementType[] = ["stroke", "rect", "ellipse", "arrow", "image", "sticker", "text", "sticky"];
/** Lofi Girl's live radio, for the focus timer. */
const LOFI_VIDEO = "rFZHOHl-L8A";
const NO_UNREAD: Unread = { count: 0, mention: false, firstId: null };
/** Types you can open for editing (double-click, double-tap or the pen button). */
const EDITABLE: ElementType[] = ["text", "note", "image", "chatbox", "sticky", "window", "rect", "ellipse"];

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

export function Board({ boardId, me, onChangeMe, viewOnly = false }: { boardId: string; me: Me; onChangeMe: (me: Me) => void; viewOnly?: boolean }) {
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
    return attachArrows([...map.values()].filter((r) => pageOf(r) === page).sort((a, b) => a.z - b.z));
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
  const [emojiFrom, setEmojiFrom] = useState<ElementRow[] | null>(null);
  // The right-click menu, and what was last copied (for "Paste here").
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const clipRef = useRef<ElementRow[]>([]);
  const [lasso, setLasso] = useState<number[][] | null>(null);
  const [eraserMode, setEraserMode] = useState<"whole" | "part">("whole");
  // How new rectangles, ellipses and arrows look.
  const [shapeStyle, setShapeStyle] = useState<{ fill: ShapeFill; dashed: boolean; opacity: number }>({ fill: "none", dashed: false, opacity: 1 });
  // Pen variants: normal, see-through highlighter, or ink that fades after a few seconds.
  const [hasEyeDropper, setHasEyeDropper] = useState(false);
  useEffect(() => queueMicrotask(() => setHasEyeDropper("EyeDropper" in window)), []);
  const [penKind, setPenKind] = useState<"pen" | "highlight" | "fade">("pen");
  // Mirror pen: copies of every stroke reflected around a centre point.
  const [mirror, setMirror] = useState<MirrorMode>(0);
  const [mirrorCenter, setMirrorCenter] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [myLaser, setMyLaser] = useState<number[][]>([]);
  const [customColors, setCustomColors] = useState<string[]>(() => {
    try {
      const v = JSON.parse(localStorage.getItem("drawory:colors") ?? "[]");
      return Array.isArray(v) ? v.slice(0, 4) : [];
    } catch {
      return [];
    }
  });
  function pickCustomColor(c: string) {
    applyStyle({ color: c });
    setCustomColors((list) => {
      const next = [c, ...list.filter((x) => x !== c)].slice(0, 4);
      try {
        localStorage.setItem("drawory:colors", JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  const [photoEditId, setPhotoEditId] = useState<string | null>(null);
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
      if (!viewOnly) rememberRoom(boardId, b.name);
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
      if (changes.length === 0 || viewOnly) return;
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
        const ops: ElementOp[] = changes.map((c, i) =>
          c.edit
            ? { op: "edit" as const, id: ids[i], edit: c.edit }
            : c.after
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
    [boardId, me.id, awaitTxId, showToast, viewOnly],
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
  /** A vote, tick or new item: shows now, and the server merges it with what others did meanwhile. */
  const applyEditTo = useCallback(
    (id: string, e: Edit) => {
      const row = rowsRef.current.get(id);
      if (!row) return;
      const after = { ...row, data: applyEdit(row.data, e), updated_at: new Date() };
      void send([{ before: committedRef.current.get(id) ?? null, after, edit: e }], false);
    },
    [send],
  );
  const deleteIds = useCallback(
    (ids: string[]) => {
      const changes = ids
        .map((id) => rowsRef.current.get(id))
        .filter((r): r is ElementRow => !!r && !r.data.locked)
        .map((r) => ({ before: committedRef.current.get(r.id) ?? r, after: null }));
      if (!changes.length) {
        if (ids.length) showToast("Locked things can't be deleted. Unlock them first.");
        return;
      }
      void send(changes);
      setSelectedId(null);
    },
    [send, setSelectedId, showToast],
  );

  /* ---------- Spotify: share what I'm listening to ---------- */
  const [spotifyLinked, setSpotifyLinked] = useState(false);
  const [shareSpotify, setShareSpotify] = useState(true);
  const [myTrack, setMyTrack] = useState<Listening | null>(null);
  const [cardDraft, setCardDraft] = useState("");
  const [cardError, setCardError] = useState<string | null>(null);
  const listeningRef = useRef<Listening | null>(null);
  // Cursor chat (press /): words that float next to my cursor for everyone.
  const sayRef = useRef<string | null>(null);
  const sayClear = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [sayOpen, setSayOpen] = useState(false);
  const [sayText, setSayText] = useState("");
  function updateSay(text: string | null, linger = 0) {
    clearTimeout(sayClear.current);
    const apply = (t: string | null) => {
      sayRef.current = t && t.trim() ? t.slice(0, 140) : null;
      pushPresenceRef.current();
    };
    if (linger) {
      apply(text);
      sayClear.current = setTimeout(() => apply(null), linger);
    } else apply(text);
  }
  // "Come here": someone wants everyone to look at what they're looking at.
  const [summon, setSummon] = useState<{ name: string; x: number; y: number; zoom: number; page: string | null } | null>(null);
  // Linked before, or just came back from Spotify's sign-in.
  useEffect(() => {
    const back = takeSpotifyReturn();
    queueMicrotask(() => {
      setSpotifyLinked(!!spotifyKey() || !!spotifyCard());
      setShareSpotify(sharingSpotify());
      if (back === "linked") showToast("Spotify connected. The room now sees what you're playing.");
      else if (back === "setup") showToast("Spotify isn't set up on this site yet (it needs a Spotify app's keys).");
      else if (back === "denied") showToast("Spotify wasn't connected.");
      else if (back === "failed") showToast("Couldn't connect Spotify. Try again.");
    });
  }, [showToast]);
  // Ask Spotify what's playing every 10 s while sharing (only while this tab is open).
  useEffect(() => {
    if (!spotifyLinked || !shareSpotify || viewOnly) {
      listeningRef.current = null;
      queueMicrotask(() => setMyTrack(null));
      return;
    }
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        try {
          const card = spotifyCard();
          const res = card
            ? await fetch("/api/spotify/card", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: card }) })
            : await fetch("/api/spotify/now", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: spotifyKey() }) });
          if (res.status === 404 || res.status === 401 || res.status === 400) {
            forgetSpotify();
            setSpotifyLinked(false);
            showToast(card ? "That Data Card link stopped working. Add it again from the menu." : "Spotify was disconnected. Connect it again from the menu.");
            return;
          }
          const { track } = (await res.json()) as { track: (Omit<Listening, "at"> & { playing: boolean }) | null };
          const next = track?.playing ? { title: track.title, artists: track.artists, image: track.image, url: track.url, progress: track.progress, duration: track.duration, at: Date.now() } : null;
          const changed = (next?.url ?? next?.title ?? null) !== (listeningRef.current?.url ?? listeningRef.current?.title ?? null);
          listeningRef.current = next;
          if (!stop) setMyTrack(next);
          if (changed) pushPresenceRef.current();
        } catch {}
      }
      if (!stop) timer = setTimeout(tick, 10_000);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [spotifyLinked, shareSpotify, viewOnly, showToast]);

  /* ---------- Fading ink ---------- */
  // Anyone online removes ink that has faded (deleting twice is harmless).
  const fadedSent = useRef(new Set<string>());
  useEffect(() => {
    if (viewOnly) return;
    const t = setInterval(() => {
      const now = serverNow();
      const gone = [...committedRef.current.values()].filter((r) => r.data.fadeAt && r.data.fadeAt < now && !fadedSent.current.has(r.id));
      if (!gone.length) return;
      for (const r of gone) fadedSent.current.add(r.id);
      void send(gone.map((r) => ({ before: r, after: null })), false);
    }, 1000);
    return () => clearInterval(t);
  }, [send, serverNow, viewOnly]);

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
  // View-only links don't join the live room (no cursor of their own); they still see every change.
  const sock = useRoomSocket(boardId, me.id, applyClock, !viewOnly);
  const sockRef = useRef(sock);
  useEffect(() => {
    sockRef.current = sock;
  });
  const lastDbPresence = useRef({ at: 0, kind: "" as string });

  const pushPresence = useCallback(
    (hidden = false, leaving = false) => {
      if (viewOnly) return;
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
        listening: hidden ? null : listeningRef.current,
        say: hidden ? null : sayRef.current,
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
  /* ---------- Unread chats ---------- */
  // What I've read, per conversation (newest message id), kept on this device.
  const seenKey = `drawory:seen:${boardId}`;
  const [seen, setSeen] = useState<Record<string, number>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(seenKey) ?? "null");
      if (stored && typeof stored === "object") return stored;
    } catch {}
    // First visit on this device: older messages don't count as unread.
    return { __since: Date.now() };
  });
  useEffect(() => {
    try {
      localStorage.setItem(seenKey, JSON.stringify(seen));
    } catch {}
  }, [seen, seenKey]);
  const markSeen = useCallback((thread: string, newestId: string) => {
    const n = Number(newestId);
    setSeen((prev) => (n <= (prev[thread] ?? 0) ? prev : { ...prev, [thread]: n }));
  }, []);
  /** Where each conversation lives on the board: a chat box, or the window holding the chat block. */
  const threadHomes = useMemo(() => {
    const homes = new Map<string, ElementRow>();
    for (const r of committed.values()) {
      if (r.type === "chatbox") homes.set(r.id, r);
      if (r.type === "window") for (const b of r.data.blocks ?? []) if (b.kind === "chat") homes.set(b.id, r);
    }
    return homes;
  }, [committed]);
  const unreadBy = useMemo(() => {
    const out = new Map<string, Unread>();
    const since = seen.__since ?? 0;
    for (const [thread, msgs] of threads) {
      if (!threadHomes.has(thread)) continue;
      let count = 0;
      let mention = false;
      let firstId: string | null = null;
      for (const m of msgs) {
        if (m.user_id === me.id || Number(m.id) <= (seen[thread] ?? 0) || m.created_at.getTime() <= since) continue;
        count++;
        mention ||= mentions(m.body, me.name);
        firstId = m.id; // newest first, so this ends on the oldest unread
      }
      if (count) out.set(thread, { count, mention, firstId });
    }
    return out;
  }, [threads, threadHomes, seen, me.id, me.name]);
  const [highlightMsg, setHighlightMsg] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const allRows = useMemo(() => [...committed.values()], [committed]);
  function jumpToHit(hit: SearchHit) {
    setSearchOpen(false);
    jumpToElement(hit.elementId);
    if (hit.messageId) setHighlightMsg(hit.messageId);
  }
  const [showMap, setShowMap] = useState(() => {
    try {
      return localStorage.getItem("drawory:minimap") !== "off";
    } catch {
      return true;
    }
  });
  function toggleMap(on: boolean) {
    setShowMap(on);
    try {
      localStorage.setItem("drawory:minimap", on ? "on" : "off");
    } catch {}
  }
  const inbox = useMemo(() => {
    let count = 0;
    let mention = false;
    let pick: { thread: string; u: Unread } | null = null;
    for (const [thread, u] of unreadBy) {
      count += u.count;
      mention ||= u.mention;
      if (!pick || (u.mention && !pick.u.mention)) pick = { thread, u };
    }
    const home = pick ? threadHomes.get(pick.thread) : null;
    const title = home ? (home.type === "chatbox" ? home.data.title || "Chat" : home.data.blocks?.find((b) => b.id === pick!.thread)?.title || home.data.title || "Window") : "";
    return { count, mention, pick, title };
  }, [unreadBy, threadHomes]);
  function jumpToUnread() {
    const p = inbox.pick;
    const home = p && threadHomes.get(p.thread);
    if (!p || !home) return;
    jumpToElement(home.id);
    setHighlightMsg(p.u.firstId);
  }
  // Someone @mentions me: say so, with a button to go there.
  const told = useRef(new Set<string>());
  useEffect(() => {
    for (const [thread, msgs] of threads) {
      const u = unreadBy.get(thread);
      if (!u?.mention) continue;
      const m = msgs.find((x) => x.user_id !== me.id && mentions(x.body, me.name));
      if (!m || told.current.has(m.id)) continue;
      told.current.add(m.id);
      const home = threadHomes.get(thread);
      if (!home) continue;
      const preview = m.body.length > 60 ? `${m.body.slice(0, 60)}…` : m.body;
      queueMicrotask(() =>
        showToast(`${m.name}: ${preview}`, false, {
          label: "Jump",
          run: () => {
            jumpToElement(home.id);
            setHighlightMsg(m.id);
          },
        }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jumpToElement is recreated each render
  }, [unreadBy]);
  const react = useCallback(
    (id: string, emoji: string) => {
      api.react(boardId, { id, emoji, user_id: me.id }).catch((e) => showToast(e instanceof Error ? e.message : "Couldn't react"));
    },
    [boardId, me.id, showToast],
  );
  const people = useMemo(() => online.map((p) => ({ name: p.name, color: p.color })), [online]);
  const roomEmojis = useMemo(() => board?.emojis ?? [], [board?.emojis]);
  const onlineIds = useMemo(() => [me.id, ...online.map((p) => p.user_id)], [me.id, online]);
  const clearInsideRef = useRef<(id: string) => void>(() => {});
  useEffect(() => {
    clearInsideRef.current = clearInside;
  });

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
      } else if (kind === "summon") {
        const p = othersRef.current.find((o) => o.user_id === from);
        const n = (k: string) => (typeof payload[k] === "number" ? (payload[k] as number) : NaN);
        if (Number.isFinite(n("x")) && Number.isFinite(n("y")) && Number.isFinite(n("zoom"))) {
          setSummon({ name: p?.name ?? "Someone", x: n("x"), y: n("y"), zoom: n("zoom"), page: typeof payload.page === "string" ? payload.page : null });
        }
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
    (kind: "wave" | "yt" | "summon", payload: Record<string, unknown> = {}) => {
      const withSid = { ...payload, sid: newId() };
      sockRef.current.send({ t: "s", kind, payload: withSid });
      return api.signal(boardId, kind, me.id, withSid);
    },
    [boardId, me.id],
  );

  const setFocus = useCallback(
    (next: FocusState | null, ifEndsAt?: number | null) => {
      setBoard((b) => (b ? { ...b, focus: next } : b));
      api
        .updateBoard(boardId, { focus: next, focusIf: ifEndsAt ?? undefined, from: me.id } as Parameters<typeof api.updateBoard>[1])
        .then(setBoard, () => showToast("Couldn't update the timer"));
    },
    [boardId, me.id, showToast],
  );
  /** Lo-fi radio for focusing: a Watch together card near the middle of the view. */
  function addLofi() {
    const existing = [...rowsRef.current.values()].find((r) => r.type === "youtube" && r.data.videoId === LOFI_VIDEO);
    if (existing) return jumpToElement(existing.id);
    addRow("youtube", { ...placeNear(480, 352), w: 480, videoId: LOFI_VIDEO, title: "Lo-fi radio", url: `https://youtu.be/${LOFI_VIDEO}` });
  }
  /** A time-lapse video of this page being made. */
  async function saveTimelapse() {
    try {
      showToast("Making the time-lapse… keep this tab open");
      const events = await api.history(boardId);
      let last = 0;
      const blob = await recordTimelapse(events, page, (p) => {
        const pct = Math.floor(p * 10) * 10;
        if (pct !== last) {
          last = pct;
          showToast(`Making the time-lapse… ${pct}%`);
        }
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(board?.name || "drawory").replace(/[\\/:*?"<>|]+/g, "")} time-lapse.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      showToast("Time-lapse saved");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't make the time-lapse");
    }
  }

  /** Brings everyone online to what I'm looking at. */
  function summonEveryone() {
    const c = centerWorld();
    void sendSignal("summon", { x: Math.round(c.x), y: Math.round(c.y), zoom: cam.current.zoom, page }).then(
      () => showToast("Bringing everyone here"),
      () => showToast("Couldn't reach everyone"),
    );
  }
  function goToSummon(s: NonNullable<typeof summon>) {
    setSummon(null);
    setFollowId(null);
    const go = () =>
      flyTo({ zoom: s.zoom, x: window.innerWidth / 2 - s.x * s.zoom, y: window.innerHeight / 2 - s.y * s.zoom });
    if (s.page && s.page !== page && pages.some((p) => p.id === s.page)) {
      switchPage(s.page);
      setTimeout(go, 80);
    } else go();
  }

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
    // Songs people are playing on Spotify (same song: one row with everyone on it).
    const songs = new Map<string, PlayingItem>();
    const addSong = (l: Listening | null, person: { name: string; color: string; me: boolean }) => {
      if (!l) return;
      const key = `spotify:${l.url ?? l.title}`;
      const item = songs.get(key) ?? { id: key, title: l.title, kind: "spotify" as const, people: [], elsewhere: null, spotify: l };
      item.people.push(person);
      songs.set(key, item);
    };
    addSong(myTrack, { name: me.name, color: me.color, me: true });
    for (const p of online) addSong(p.listening, { name: p.name, color: p.color, me: false });
    return [...byId.values(), ...songs.values()];
  }, [watching, online, committed, rowsById, me.name, me.color, page, pages, myTrack]);

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
    // Locked things (a background, a title) survive a clear.
    const ids = [...rowsRef.current.values()].filter((r) => !r.data.locked).map((r) => r.id);
    if (!ids.length) return showToast("Nothing to clear. Locked things stay.");
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
    if (t === "game") {
      // A Pictionary area: drawings for the game go inside it. Move and resize it like a place.
      const w = 900, h = 560;
      addRow("game", { ...placeNear(w, h), w, h, game: { status: "lobby", round: 0, players: [], correct: [] } });
      setTool("select");
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
      const base = STROKE_SIZES.find((s) => s.id === sizeId)?.px ?? 6;
      const px = penKind === "highlight" ? base * 3 : base;
      const data: ElementData = { ...normalizePoints(points, px), size: px, color: colorId };
      if (penKind === "highlight") data.highlight = true;
      if (penKind === "fade") {
        data.fadeFrom = Math.round(serverNow());
        data.fadeAt = data.fadeFrom + FADE_MS;
      }
      return data;
    },
    [sizeId, colorId, penKind, serverNow],
  );

  const eraseAt = useCallback(
    (clientX: number, clientY: number, g: Extract<Gesture, { kind: "erase" }>) => {
      const hits: { id: string; row: null }[] = [];
      for (const node of document.elementsFromPoint(clientX, clientY)) {
        const id = (node as HTMLElement).closest?.("[data-el]")?.getAttribute("data-el");
        if (!id || g.originals.has(id)) continue;
        const row = rowsRef.current.get(id);
        if (!row || row.type === "place" || row.data.locked) continue;
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

  /** Shows (and shares) the clean shape a stroke was turned into. */
  function showSnapped(r: Recognized) {
    if (r.kind === "line" || r.kind === "polygon") {
      const pts = r.kind === "line" ? sampleSegments([r.a, r.b], false) : sampleSegments(r.pts, true);
      setDraft(mkRow("stroke", strokeData(pts), nextZ(), me.id));
      shareStroke(pts);
      return;
    }
    const px = STROKE_SIZES.find((s) => s.id === sizeId)?.px ?? 6;
    const data = { x: r.x, y: r.y, w: Math.max(8, r.w), h: Math.max(8, r.h), color: colorId, size: Math.max(2, px * 0.6) };
    setDraft(mkRow(r.kind, data, nextZ(), me.id));
    setActivity({ k: "shape", t: r.kind, d: data });
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
      } else if (editingRow?.type === "rect" || editingRow?.type === "ellipse") {
        const box = rootRef.current?.querySelector<HTMLElement>(`[data-el="${editingId}"] .shape-text-edit`);
        const text = box?.innerText.trim() ?? "";
        if (box && text !== (editingRow.data.text ?? "")) patch(editingId, { text });
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
    // View-only: dragging always moves around; buttons on cards (play, links) still work.
    const panning = laneOpen || viewOnly || tool === "hand" || spaceHeld || e.button === 1;
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
          if (!original || original.data.locked) return;
          if (target.closest("[data-handle]")?.getAttribute("data-handle") === "rotate") {
            const b = bounds(original);
            gesture.current = { kind: "rotate", original, cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
          } else gesture.current = { kind: "resize", wx: w.x, wy: w.y, original };
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
            if (again && EDITABLE.includes(row.type) && !row.data.locked) {
              primeKeyboard(e.pointerType);
              setSelectedId(elId);
              setEditingId(elId);
              return;
            }
          }
          if (e.shiftKey || e.ctrlKey || e.metaKey) {
            // Add to or remove from the selection, like Ctrl/Shift-click in a file manager.
            const members = withGroups([elId]);
            setSelectedIds((ids) => (ids.includes(elId) ? ids.filter((i) => !members.includes(i)) : [...new Set([...ids, ...members])]));
            return;
          }
          // Dragging any selected item moves the whole selection (and the rest of its group).
          const group = selectedSet.has(elId) ? selectedIds : withGroups([elId]);
          if (!selectedSet.has(elId)) setSelectedIds(group);
          startMove(group, w);
          return;
        }
        // Pressing anywhere inside what's selected (between the lines of a drawing, say) moves it too.
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey && selectedIds.length) {
          const box = unionBounds(selectedIds.map((id) => rowsRef.current.get(id)).filter((r): r is ElementRow => !!r && !isArea(r.type)));
          const pad = 8 / cam.current.zoom;
          if (box && w.x >= box.x - pad && w.x <= box.x + box.w + pad && w.y >= box.y - pad && w.y <= box.y + box.h + pad) {
            startMove(selectedIds, w);
            return;
          }
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
        if (blockedByGame(w.x, w.y)) return;
        const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
        // Shift: a straight line from the start, in 15° steps.
        gesture.current = { kind: "draw", points: [[w.x, w.y, pressure]], straight: e.shiftKey };
        setDraft(mkRow("stroke", strokeData([[w.x, w.y, pressure]]), nextZ(), me.id));
        shareStroke([[w.x, w.y]]);
        return;
      }
      case "lasso": {
        gesture.current = { kind: "lasso", pts: [[w.x, w.y]] };
        setLasso([[w.x, w.y]]);
        return;
      }
      case "laser": {
        gesture.current = { kind: "laser", pts: [[w.x, w.y]] };
        setMyLaser([[w.x, w.y]]);
        return;
      }
      case "eraser": {
        if (eraserMode === "part") {
          const g: Gesture = { kind: "erasePart", path: [[w.x, w.y]], touched: new Map(), temp: new Map() };
          gesture.current = g;
          erasePartAt(g);
          return;
        }
        const g: Gesture = { kind: "erase", originals: new Map() };
        gesture.current = g;
        eraseAt(e.clientX, e.clientY, g);
        return;
      }
      case "rect":
      case "ellipse":
      case "arrow":
        if (blockedByGame(w.x, w.y)) return;
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
      case "laser": {
        g.pts.push([Math.round(w.x), Math.round(w.y)]);
        const recent = g.pts.slice(-30);
        setMyLaser(recent);
        setActivity({ k: "laser", pts: recent });
        break;
      }
      case "draw": {
        const first = g.points[0];
        // Straightened: the line's end follows the pen (Shift keeps it to 15° steps).
        if (g.straight || g.snapped?.kind === "line") {
          const a: [number, number] = [first[0], first[1]];
          const b = e.shiftKey || g.straight ? snapAngle(a, [w.x, w.y]) : ([w.x, w.y] as [number, number]);
          g.snapped = { kind: "line", a, b };
          showSnapped(g.snapped);
          break;
        }
        if (g.snapped) break; // a clean shape stays as it is until you let go
        const last = g.points[g.points.length - 1];
        if (Math.hypot(w.x - last[0], w.y - last[1]) * cam.current.zoom < 1.5) break;
        g.points.push([w.x, w.y, e.pointerType === "pen" ? e.pressure || 0.5 : 0.5]);
        if (draftRef.current) setDraft({ ...draftRef.current, data: strokeData(g.points) });
        shareStroke(g.points);
        // Rest the pen for a moment and the stroke becomes a clean line or shape.
        clearTimeout(g.hold);
        g.hold = setTimeout(() => {
          if (gesture.current !== g) return;
          const r = recognize(g.points);
          if (!r) return;
          g.snapped = r;
          showSnapped(r);
          navigator.vibrate?.(8);
        }, HOLD_TO_STRAIGHTEN_MS);
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
            dashed: shapeStyle.dashed || undefined, opacity: shapeStyle.opacity < 1 ? shapeStyle.opacity : undefined,
            points: [[g.ox - x, g.oy - y], [g.ox + dx - x, g.oy + dy - y]],
          }, nextZ(), me.id);
        } else {
          shapeRow = mkRow(g.type, {
            x: Math.min(g.ox, g.ox + dx), y: Math.min(g.oy, g.oy + dy), w: Math.abs(dx), h: Math.abs(dy), color: colorId, size: width,
            fill: shapeStyle.fill === "none" ? undefined : shapeStyle.fill, dashed: shapeStyle.dashed || undefined,
            opacity: shapeStyle.opacity < 1 ? shapeStyle.opacity : undefined,
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
        // Recent pointer positions, so a sticker let go mid-swipe keeps sliding.
        g.samples = [...(g.samples ?? []).slice(-5), [performance.now(), e.clientX, e.clientY]];
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
            if (moving.has(r.id) || r.type === "stroke" || isArea(r.type) || pageOf(r) !== page) continue;
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
      case "erasePart":
        g.path.push([w.x, w.y]);
        erasePartAt(g);
        break;
      case "rotate": {
        let deg = (Math.atan2(w.y - g.cy, w.x - g.cx) * 180) / Math.PI + 90;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        else {
          // Settle on straight when close.
          const near = Math.round(deg / 90) * 90;
          if (Math.abs(deg - near) < 4) deg = near;
        }
        deg = ((Math.round(deg) % 360) + 360) % 360;
        const data = { angle: deg || undefined };
        preview([{ id: g.original.id, row: { ...g.original, data: { ...g.original.data, ...data } } }]);
        setActivity({ k: "resize", id: g.original.id, d: data });
        break;
      }
      case "lasso":
        g.pts.push([w.x, w.y]);
        setLasso([...g.pts]);
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
          // A selection box sweeps past locked things (a background, say); click them to pick them.
          if (r.data.locked) continue;
          if (isArea(r.type) ? contains(box, b) : touches) hit.push(r.id);
        }
        setSelectedIds([...new Set([...g.base, ...withGroups(hit)])]);
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
      case "laser":
        endActivity(0);
        break;
      case "draw": {
        clearTimeout(g.hold);
        let made: ElementRow | null = null;
        if (g.snapped) {
          const d = draftRef.current;
          if (d) made = { ...d, id: newId(), z: nextZ() };
        } else {
          const end = toWorld(e.clientX, e.clientY);
          const last = g.points[g.points.length - 1];
          if (Math.hypot(end.x - last[0], end.y - last[1]) > 0.5) g.points.push([end.x, end.y, last[2]]);
          if (g.points.length === 1) g.points.push([g.points[0][0] + 0.1, g.points[0][1] + 0.1, 0.5]);
          made = mkRow("stroke", strokeData(g.points), nextZ(), me.id);
        }
        setDraft(null);
        if (made && made.type === "stroke" && !mirror) {
          const b = bounds(made);
          const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
          for (const r of rowsRef.current.values()) {
            if (r.type !== "youtube") continue;
            const rb = bounds(r);
            if (cx < rb.x || cx > rb.x + rb.w || cy < rb.y || cy > rb.y + rb.h) continue;
            const t = videoTime(r.id);
            if (t !== null && t > 0.3) {
              made = { ...made, data: { ...made.data, videoAt: { id: r.id, t: Math.round(t * 10) / 10 } } };
              showToast(`Note pinned to ${formatVideoTime(t)} of the video. It shows up at that moment.`);
            }
            break;
          }
        }
        if (made) {
          // Mirror pen: the copies are grouped with the stroke, so they move together.
          const copies = mirror ? mirrorTransforms(mirror, mirrorCenter.x, mirrorCenter.y) : [];
          const group = copies.length ? newId() : undefined;
          const all = [made, ...copies.map((t) => ({ ...made!, id: newId(), data: transformData(made!, t) }))].map((r) =>
            group ? { ...r, data: { ...r.data, group } } : r,
          );
          void send(all.map((r) => ({ before: null, after: r })));
        }
        endActivity();
        break;
      }
      case "shape": {
        const d = draftRef.current;
        setDraft(null);
        const big = d && (d.type === "arrow" ? Math.hypot(d.data.w ?? 0, d.data.h ?? 0) > 50 : (d.data.w ?? 0) > 6 && (d.data.h ?? 0) > 6);
        if (d && big) {
          // An arrow that starts or ends on an item sticks to it.
          let row = { ...d, id: newId() };
          if (d.type === "arrow") {
            const [[x1, y1], [x2, y2]] = d.data.points ?? [[0, 0], [0, 0]];
            const from = itemAt(d.data.x + x1, d.data.y + y1);
            const to = itemAt(d.data.x + x2, d.data.y + y2);
            if ((from || to) && from !== to) row = { ...row, data: { ...row.data, from: from ?? undefined, to: to ?? undefined } };
          }
          void send([{ before: null, after: row }]);
        }
        endActivity(big ? 600 : 0);
        break;
      }
      case "move":
        setGuides([]);
        markDrop(null);
        if (g.moved && g.into && dropIntoWindow(g.originals, g.into)) {
          endActivity();
        } else if (g.moved && g.originals.length === 1 && g.originals[0].type === "sticker" && flickSpeed(g.samples)) {
          const v = flickSpeed(g.samples)!;
          flick(rowsRef.current.get(g.originals[0].id) ?? g.originals[0], g.originals[0], v[0] / cam.current.zoom, v[1] / cam.current.zoom);
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
      case "erasePart": {
        // Each touched stroke is replaced by what's left of it.
        const changes: Change[] = [];
        for (const [id, orig] of g.touched) {
          for (const tmp of g.temp.get(id) ?? []) dropPreview(tmp);
          const pieces = eraseFromStroke(orig, densify(g.path, eraseRadius() / 2), eraseRadius());
          changes.push({ before: orig, after: null });
          for (const data of pieces) changes.push({ before: null, after: { ...orig, id: newId(), data } });
        }
        if (changes.length) void send(changes);
        endActivity();
        break;
      }
      case "rotate": {
        const after = rowsRef.current.get(g.original.id);
        if (after) void send([{ before: committedRef.current.get(after.id) ?? g.original, after }]);
        endActivity();
        break;
      }
      case "lasso": {
        setLasso(null);
        const poly = g.pts;
        if (poly.length < 3) break;
        const hit: string[] = [];
        for (const r of rowsRef.current.values()) {
          if (r.data.locked) continue;
          const b = bounds(r);
          if (inPolygon(b.x + b.w / 2, b.y + b.h / 2, poly)) hit.push(r.id);
        }
        setTool("select");
        setSelectedIds(withGroups(hit));
        break;
      }
      case "marquee":
        setMarquee(null);
        endActivity(0);
        break;
    }
  }

  function onDoubleClick(e: React.MouseEvent) {
    if (tool !== "select" || viewOnly) return;
    const id = (e.target as HTMLElement).closest("[data-el]")?.getAttribute("data-el");
    const row = id ? rowsRef.current.get(id) : null;
    if (row && EDITABLE.includes(row.type) && !row.data.locked) setEditingId(row.id);
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
      } else if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "/" && !mod && !laneOpen && !viewOnly) {
        e.preventDefault();
        setSayText("");
        setSayOpen(true);
      } else if (mod && e.key.toLowerCase() === "d" && selectedIds.length && !laneOpen) {
        e.preventDefault();
        duplicateSelection();
      } else if (mod && e.key.toLowerCase() === "g" && selectedIds.length && !laneOpen) {
        e.preventDefault();
        toggleGroup();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "l" && selectedIds.length && !laneOpen) {
        e.preventDefault();
        toggleLock();
      } else if (e.key.startsWith("Arrow") && selectedIds.length && !laneOpen) {
        e.preventDefault();
        const step = e.shiftKey ? 20 : 2;
        const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key] ?? [0, 0];
        nudgeSelection(dir[0] * step, dir[1] * step);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.length && !laneOpen) {
        e.preventDefault();
        deleteIds(selectedIds);
      } else if (e.key === "Escape") {
        setSelectedIds([]);
        setMenuOpen(false);
      } else if (e.key === " " && !e.repeat) {
        e.preventDefault();
        setSpaceHeld(true);
      } else if (!mod && !e.altKey && KEY_TOOLS[e.key.toLowerCase()] && !laneOpen && !viewOnly) {
        chooseTool(KEY_TOOLS[e.key.toLowerCase()] as Tool);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceHeld(false);
    };
    const onCopy = (e: ClipboardEvent, cut = false) => {
      if (isEditable(e.target) || dialog || laneOpen || !selectedIds.length) return;
      const picked = selectedIds.map((id) => rowsRef.current.get(id)).filter((r): r is ElementRow => !!r);
      if (!picked.length) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", CLIP_PREFIX + JSON.stringify(picked.map((r) => ({ type: r.type, data: r.data }))));
      clipRef.current = picked;
      if (cut) deleteIds(picked.map((r) => r.id));
      showToast(cut ? "Cut. Paste it anywhere, even in another room." : "Copied. Paste it anywhere, even in another room.");
    };
    const onCut = (e: ClipboardEvent) => onCopy(e, true);
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target) || dialog || laneOpen || viewOnly) return;
      const clip = e.clipboardData?.getData("text/plain") ?? "";
      if (clip.startsWith(CLIP_PREFIX)) {
        e.preventDefault();
        try {
          const items = (JSON.parse(clip.slice(CLIP_PREFIX.length)) as { type: ElementType; data: ElementData }[]).filter(
            (x) => x && typeof x.type === "string" && x.data && typeof x.data.x === "number",
          );
          const fake = items.map((x) => ({ ...makeRow(x.type, x.data, 0, me.id) }));
          const box = unionBounds(fake);
          if (!box) return;
          const c = centerWorld();
          const copies = cloneRows(fake, c.x - (box.x + box.w / 2), c.y - (box.y + box.h / 2));
          void send(copies.map((r) => ({ before: null, after: r })));
          setTool("select");
          setSelectedIds(copies.map((r) => r.id));
        } catch {
          showToast("Couldn't paste that.");
        }
        return;
      }
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
    window.addEventListener("copy", onCopy);
    window.addEventListener("cut", onCut);
    return () => {
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("cut", onCut);
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
  const moveBlockOutRef = useRef<{ out: typeof moveBlockOut; to: typeof moveBlockTo; play: typeof playSong } | null>(null);
  useEffect(() => {
    moveBlockOutRef.current = { out: moveBlockOut, to: moveBlockTo, play: playSong };
  });
  const ctx: BoardCtx = useMemo(
    () => ({
      boardId,
      me,
      readOnly: laneOpen || viewOnly,
      zoom: camera.zoom,
      watchers,
      serverNow,
      patch,
      edit: applyEditTo,
      finishText,
      reportTyping,
      chatFor: (thread) => threads.get(thread) ?? NO_CHAT,
      react,
      markSeen,
      unread: (thread) => unreadBy.get(thread) ?? NO_UNREAD,
      people,
      roomEmojis,
      onlineIds,
      clearInside: (id) => clearInsideRef.current(id),
      highlightMsg,
      sendChat: sendTo,
      stopEditing: () => setEditingId(null),
      moveBlockOut: (winId, blockId, at) => void moveBlockOutRef.current?.out(winId, blockId, at),
      moveBlockTo: (from, blockId, to, near) => moveBlockOutRef.current?.to(from, blockId, to, near),
      playSong: (win, blockId, videoId, title) => moveBlockOutRef.current?.play(win, blockId, videoId, title),
      startEditing: (id) => {
        setSelectedId(id);
        setEditingId(id);
      },
      sendYt,
      onYt,
      setWatching: setWatchingState,
      onListener,
      editPhoto: (id) => setPhotoEditId(id),
      openCapsule: (id) => setDialog({ kind: "capsuleOpen", id, title: rowsRef.current.get(id)?.data.title || "Time capsule" }),
      addToCapsule: (id) => setDialog({ kind: "capsuleNote", id }),
    }),
    [boardId, me, laneOpen, camera.zoom, watchers, serverNow, patch, applyEditTo, finishText, reportTyping, threads, react, markSeen, unreadBy, people, roomEmojis, onlineIds, highlightMsg, sendTo, sendYt, onYt, onListener, setEditingId, setSelectedId],
  );

  /* ---------- Others' live activity ---------- */
  const remote = useMemo(() => {
    const override = new Map<string, Partial<ElementData>>();
    const marks = new Map<string, RemoteMark>();
    const drafts: { key: string; row: ElementRow; color: string }[] = [];
    const boxes: { key: string; b: [number, number, number, number]; color: string }[] = [];
    const selections: { key: string; ids: string[]; color: string; name: string }[] = [];
    const lasers: { key: string; color: string; pts: number[][] }[] = [];
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
        case "laser":
          lasers.push({ key: p.user_id, color: p.color, pts: a.pts ?? [] });
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
    return { override, marks, drafts, boxes, selections, lasers };
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
    laser: " · pointing",
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
  const placesLayer = displayRows.filter((r) => isArea(r.type));
  const contentLayer = displayRows.filter((r) => !isArea(r.type));
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
  const shapeSel = selectedRows.find((r) => r.type === "rect" || r.type === "ellipse" || r.type === "arrow");
  const showShapeStyle = tool === "rect" || tool === "ellipse" || tool === "arrow" || (tool === "select" && !!shapeSel);
  const activeShape =
    tool === "select" && shapeSel
      ? { fill: (shapeSel.data.fill ?? "none") as ShapeFill, dashed: !!shapeSel.data.dashed, opacity: shapeSel.data.opacity ?? 1 }
      : shapeStyle;
  const laserFeeds = useMemo(
    () => [...(myLaser.length ? [{ key: "me", color: me.color, pts: myLaser }] : []), ...remote.lasers],
    [myLaser, me.color, remote.lasers],
  );
  const selBox = selectedRows.length ? unionBounds(selectedRows) : null;
  const iLike = selectedRows.length > 0 && selectedRows.every((r) => r.data.likes?.includes(me.id));

  function applyStyle(next: { color?: string; size?: number; font?: string; fontSize?: number; fill?: ShapeFill; dashed?: boolean; opacity?: number }) {
    if (next.fill) setShapeStyle((s) => ({ ...s, fill: next.fill! }));
    if (next.dashed !== undefined) setShapeStyle((s) => ({ ...s, dashed: next.dashed! }));
    if (next.opacity) setShapeStyle((s) => ({ ...s, opacity: next.opacity! }));
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
      const shape = r.type === "rect" || r.type === "ellipse" || r.type === "arrow";
      if (next.fill && (r.type === "rect" || r.type === "ellipse")) data.fill = next.fill;
      if (next.dashed !== undefined && shape) data.dashed = next.dashed;
      if (next.opacity && (shape || r.type === "stroke" || r.type === "text")) data.opacity = next.opacity;
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
  const isGroup = selectedRows.length > 1 && selectedRows.every((r) => r.data.group && r.data.group === selectedRows[0].data.group);
  const allLocked = selectedRows.length > 0 && selectedRows.every((r) => r.data.locked);
  const pageTemplates = useTemplates("page");
  const [pageTplName, setPageTplName] = useState<string | null>(null);
  function savePageTemplate() {
    const list = rows.filter((r) => r.type !== "capsule");
    const box = unionBounds(list);
    if (!box) return showToast("This page is empty");
    const name = (pageTplName ?? "").trim() || pages.find((p) => p.id === page)?.name || "My page";
    try {
      saveTemplate({
        kind: "page",
        name,
        items: list.map((r) => ({
          type: r.type,
          data: { ...r.data, x: r.data.x - box.x, y: r.data.y - box.y, page: undefined, likes: undefined, locked: undefined },
        })),
      });
      showToast(`Saved “${name}” as a template`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't save it");
    }
    setPageTplName(null);
  }
  function applyPageTemplate(items: { type: ElementType; data: ElementData }[]) {
    const fake = items.map((x) => makeRow(x.type, x.data, 0, me.id));
    const box = unionBounds(fake);
    if (!box) return;
    const c = centerWorld();
    const copies = cloneRows(fake, c.x - (box.x + box.w / 2), c.y - (box.y + box.h / 2));
    void send(copies.map((r) => ({ before: null, after: r })));
    setTool("select");
    setSelectedIds(copies.map((r) => r.id));
    setMenuOpen(false);
  }
  const isCreator = !!board?.created_by && board.created_by === me.id && !viewOnly;
  const canClear = !viewOnly && (!board?.settings?.creatorOnlyClear || isCreator);

  async function copyViewLink() {
    try {
      const { code } = await api.viewLink(boardId);
      if (!code) return;
      setBoard((b) => (b ? { ...b, view_code: code } : b));
      const link = `${window.location.origin}/v/${code}`;
      await navigator.clipboard.writeText(link).catch(() => {});
      showToast("View-only link copied. People with it can look, but not change anything.");
    } catch {
      showToast("Couldn't make the link. Try again.");
    }
  }
  async function turnOffViewLink() {
    try {
      await api.viewLink(boardId, { off: true });
      setBoard((b) => (b ? { ...b, view_code: null } : b));
      showToast("View-only link turned off");
    } catch {
      showToast("Couldn't turn it off. Try again.");
    }
  }
  /** A picture of some items on the board: transparent, at most `side` pixels across. */
  async function picturePng(list: ElementRow[], side: number) {
    const b = unionBounds(list);
    const world = rootRef.current?.querySelector<HTMLElement>(".world");
    if (!b || !world) return null;
    const { toPng } = await import("html-to-image");
    const pad = 6;
    const w = Math.ceil(b.w + pad * 2), h = Math.ceil(b.h + pad * 2);
    const ids = new Set(list.map((r) => r.id));
    const skip = ["resize-handle", "rotate-handle", "cursor", "remote-tag", "lock-chip", "like-chip"];
    return toPng(world, {
      width: w,
      height: h,
      pixelRatio: Math.min(4, side / Math.max(w, h)),
      style: { transform: `translate(${pad - b.x}px, ${pad - b.y}px)`, transformOrigin: "0 0" },
      filter: (n) => {
        if (!(n instanceof HTMLElement)) return true;
        if (n.dataset.el) return ids.has(n.dataset.el);
        return n.tagName !== "IFRAME" && !skip.some((c) => n.classList.contains(c));
      },
    });
  }
  function startEmojiFrom(list: ElementRow[]) {
    setEmojiFrom(list.filter((r) => EMOJI_TYPES.includes(r.type)));
  }
  async function makeEmoji(name: string) {
    const list = emojiFrom ?? [];
    setSelectedIds([]);
    await new Promise((r) => setTimeout(r, 60));
    const png = await picturePng(list, 128).catch(() => null);
    if (!png) throw new Error("Couldn't draw the picture");
    const blob = await (await fetch(png)).blob();
    const up = await api.upload(boardId, blob, `${name}.png`);
    const res = await api.addEmoji(boardId, { name, url: up.url, from: me.id });
    setBoard((b) => (b ? { ...b, emojis: res.emojis } : b));
    showToast(`:${name}: is ready. Use it in any chat in this room.`);
    setEmojiFrom(null);
  }

  /** Saves the page (or the selection) as a PNG. Videos and web embeds show as blank cards. */
  async function exportPng(onlySelection: boolean) {
    const list = onlySelection && selectedRows.length ? selectedRows : rows;
    const b = unionBounds(list);
    const world = rootRef.current?.querySelector<HTMLElement>(".world");
    if (!b || !world) return showToast("Nothing to save yet");
    const keep = selectedIdsRef.current;
    setSelectedIds([]);
    setEditingId(null);
    showToast("Making the picture…");
    await new Promise((r) => setTimeout(r, 80));
    try {
      const { toPng } = await import("html-to-image");
      const pad = 48;
      const w = Math.ceil(b.w + pad * 2), h = Math.ceil(b.h + pad * 2);
      const ids = new Set(list.map((r) => r.id));
      const skip = ["resize-handle", "cursor", "remote-tag", "marquee", "snap-guide", "lock-chip", "like-chip", "sel-box"];
      const url = await toPng(world, {
        width: w,
        height: h,
        pixelRatio: Math.max(0.5, Math.min(2, 6000 / Math.max(w, h))),
        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#ffffff",
        style: { transform: `translate(${pad - b.x}px, ${pad - b.y}px)`, transformOrigin: "0 0" },
        filter: (n) => {
          if (!(n instanceof HTMLElement)) return true;
          if (n.dataset.el) return ids.has(n.dataset.el);
          return n.tagName !== "IFRAME" && !skip.some((c) => n.classList.contains(c));
        },
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(board?.name || "drawory").replace(/[\\/:*?"<>|]+/g, "")} - ${pages.find((p) => p.id === page)?.name ?? "page"}.png`;
      a.click();
      showToast("Picture saved");
    } catch {
      showToast("Couldn't make the picture. Try again.");
    } finally {
      setSelectedIds(keep);
    }
  }

  function sendToBack(list: ElementRow[]) {
    let min = Infinity;
    for (const r of rowsRef.current.values()) min = Math.min(min, r.z);
    let z = (Number.isFinite(min) ? min : 0) - list.length;
    const sorted = [...list].sort((a, b) => a.z - b.z);
    void send(sorted.map((r) => ({ before: committedRef.current.get(r.id) ?? r, after: { ...r, z: z++ } })));
  }
  function bringToFront(list: ElementRow[]) {
    let z = nextZ();
    const sorted = [...list].sort((a, b) => a.z - b.z);
    void send(sorted.map((r) => ({ before: committedRef.current.get(r.id) ?? r, after: { ...r, z: z++ } })));
  }
  function pasteAt(items: ElementRow[], at: { x: number; y: number }) {
    const box = unionBounds(items);
    if (!box) return;
    const copies = cloneRows(items, at.x - box.x, at.y - box.y);
    void send(copies.map((r) => ({ before: null, after: r })));
    setTool("select");
    setSelectedIds(copies.map((r) => r.id));
  }

  /** Right click: a menu of what you can do with what's under the pointer. */
  function onContextMenu(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    // Text boxes keep the browser's own menu (spelling, paste).
    if (isEditable(target) || target.closest("[contenteditable=true], input, textarea") || laneOpen) return;
    e.preventDefault();
    if (viewOnly) return;
    gesture.current = null;
    const w = toWorld(e.clientX, e.clientY);
    const elId = target.closest("[data-el]")?.getAttribute("data-el");
    const items: MenuItem[] = [];
    if (elId && rowsRef.current.get(elId)) {
      const ids = selectedIdsRef.current.includes(elId) ? selectedIdsRef.current : withGroups([elId]);
      if (!selectedIdsRef.current.includes(elId)) {
        setTool("select");
        setSelectedIds(ids);
      }
      selectedIdsRef.current = ids;
      const list = ids.map((id) => rowsRef.current.get(id)).filter((r): r is ElementRow => !!r);
      const one = list.length === 1 ? list[0] : null;
      const locked = list.every((r) => r.data.locked);
      const grouped = list.length > 1 && list.every((r) => r.data.group && r.data.group === list[0].data.group);
      if (one && EDITABLE.includes(one.type) && !one.data.locked) items.push({ label: "Edit", icon: "pen", run: () => setEditingId(one.id) });
      if (one?.type === "image" && !one.data.locked) items.push({ label: "Crop and rotate", icon: "crop", run: () => setPhotoEditId(one.id) });
      items.push(
        {
          label: "Copy",
          icon: "copy",
          hint: "Ctrl+C",
          run: () => {
            clipRef.current = list;
            void navigator.clipboard?.writeText(CLIP_PREFIX + JSON.stringify(list.map((r) => ({ type: r.type, data: r.data })))).catch(() => {});
            showToast("Copied");
          },
        },
        { label: "Duplicate", icon: "copy", hint: "Ctrl+D", run: duplicateSelection },
        "sep",
        { label: "Bring to front", icon: "front", run: () => bringToFront(list) },
        { label: "Send to back", icon: "back2", run: () => sendToBack(list) },
        "sep",
      );
      if (list.length > 1) items.push({ label: grouped ? "Ungroup" : "Group", icon: grouped ? "ungroup" : "group", hint: "Ctrl+G", run: toggleGroup });
      items.push({ label: locked ? "Unlock" : "Lock", icon: locked ? "lock" : "unlock", hint: "Ctrl+Shift+L", run: toggleLock });
      if (list.some((r) => EMOJI_TYPES.includes(r.type))) items.push({ label: "Make an emoji", icon: "smile", run: () => startEmojiFrom(list) });
      items.push({ label: "Save as a picture", icon: "download", run: () => void exportPng(true) }, "sep", {
        label: list.length > 1 ? `Delete ${list.length} things` : "Delete",
        icon: "trash",
        danger: true,
        hint: "Del",
        run: () => deleteIds(ids),
      });
    } else {
      setSelectedIds([]);
      if (clipRef.current.length) items.push({ label: "Paste here", icon: "copy", hint: "Ctrl+V", run: () => pasteAt(clipRef.current, w) });
      items.push(
        { label: "Sticky note here", icon: "stickynote", run: () => addRow("sticky", { x: w.x - 100, y: w.y - 100, w: 200, h: 200, text: "", color: stickyColor }) },
        { label: "Window here", icon: "window", run: () => addRow("window", { x: w.x - 320, y: w.y - 40, w: 640, title: "Window", blocks: [] }) },
        { label: "Text here", icon: "text", run: () => { setTool("text"); } },
        "sep",
        { label: "Select everything", hint: "Ctrl+A", icon: "select", run: () => { setTool("select"); setSelectedIds([...rowsRef.current.keys()]); } },
        { label: "Show everything", hint: "Shift+1", icon: "fit", run: fitAll },
      );
    }
    setMenuAt({ x: e.clientX, y: e.clientY, items });
  }

  /** During a Pictionary round, only the person whose turn it is draws inside that game's area. */
  function blockedByGame(x: number, y: number) {
    for (const r of rowsRef.current.values()) {
      const g = r.type === "game" ? r.data.game : null;
      if (!g || (g.status !== "drawing" && g.status !== "choosing") || g.drawer === me.id) continue;
      const b = bounds(r);
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        const who = g.players.find((p) => p.id === g.drawer)?.name ?? "someone else";
        showToast(`It's ${who}'s turn to draw here. Guess in the box on the side!`);
        return true;
      }
    }
    return false;
  }
  /** Clears what's drawn inside an area (not the area itself, locked things or windows). */
  function clearInside(areaId: string) {
    const area = rowsRef.current.get(areaId);
    if (!area) return;
    const b = bounds(area);
    const ids = [...rowsRef.current.values()]
      .filter((r) => r.id !== areaId && !isArea(r.type) && r.type !== "window" && !r.data.locked && contains(b, bounds(r)))
      .map((r) => r.id);
    if (ids.length) deleteIds(ids);
  }

  /** How fast the pointer was moving when let go (px per ms), if it was a flick. */
  function flickSpeed(samples?: number[][]) {
    if (!samples || samples.length < 2) return null;
    const a = samples[0], b = samples[samples.length - 1];
    const dt = b[0] - a[0];
    if (dt <= 0 || performance.now() - b[0] > 80) return null;
    const vx = (b[1] - a[1]) / dt, vy = (b[2] - a[2]) / dt;
    return Math.hypot(vx, vy) > 0.6 ? ([vx, vy] as const) : null;
  }
  /** A flicked sticker slides, slows down and bounces off other things and the edges of the view. */
  function flick(current: ElementRow, original: ElementRow, vx: number, vy: number) {
    let row = current;
    const others = [...rowsRef.current.values()].filter((r) => r.id !== row.id && !isArea(r.type) && r.type !== "stroke").map((r) => bounds(r));
    let last = performance.now();
    const step = (t: number) => {
      const dt = Math.min(40, t - last);
      last = t;
      const b = bounds(row);
      let x = row.data.x + vx * dt;
      let y = row.data.y + vy * dt;
      for (const o of others) {
        if (x >= o.x + o.w || x + b.w <= o.x || y >= o.y + o.h || y + b.h <= o.y) continue;
        const px = Math.min(x + b.w - o.x, o.x + o.w - x);
        const py = Math.min(y + b.h - o.y, o.y + o.h - y);
        if (px < py) {
          x += x + b.w / 2 < o.x + o.w / 2 ? -px : px;
          vx = -vx * 0.75;
        } else {
          y += y + b.h / 2 < o.y + o.h / 2 ? -py : py;
          vy = -vy * 0.75;
        }
      }
      const c = cam.current;
      const left = -c.x / c.zoom, top = -c.y / c.zoom;
      const right = left + window.innerWidth / c.zoom, bottom = top + window.innerHeight / c.zoom;
      if (x < left) [x, vx] = [left, Math.abs(vx) * 0.75];
      if (x + b.w > right) [x, vx] = [right - b.w, -Math.abs(vx) * 0.75];
      if (y < top) [y, vy] = [top, Math.abs(vy) * 0.75];
      if (y + b.h > bottom) [y, vy] = [bottom - b.h, -Math.abs(vy) * 0.75];
      const friction = Math.pow(0.9965, dt);
      vx *= friction;
      vy *= friction;
      row = { ...row, data: { ...row.data, x, y } };
      preview([{ id: row.id, row }]);
      setActivity({ k: "move", items: [[row.id, Math.round(x), Math.round(y)]] });
      if (Math.hypot(vx, vy) > 0.02) nextFrame(step);
      else {
        void send([{ before: committedRef.current.get(row.id) ?? original, after: { ...row, data: { ...row.data, x: Math.round(x), y: Math.round(y) } } }]);
        endActivity();
      }
    };
    nextFrame(step);
  }

  /** Starts dragging these items (and whatever sits inside any area among them). */
  function startMove(group: string[], w: { x: number; y: number }) {
    const ids = new Set(group);
    for (const id of group) {
      const r = rowsRef.current.get(id);
      if (!r || !isArea(r.type)) continue;
      const area = bounds(r);
      for (const other of rowsRef.current.values()) if (!isArea(other.type) && contains(area, bounds(other))) ids.add(other.id);
    }
    // Locked items stay where they are. An arrow dragged away from what it's attached to lets go.
    const originals = [...ids]
      .map((id) => rowsRef.current.get(id))
      .filter((r): r is ElementRow => !!r && !r.data.locked)
      .map((r) =>
        r.type === "arrow" && ((r.data.from && !ids.has(r.data.from)) || (r.data.to && !ids.has(r.data.to)))
          ? { ...r, data: { ...r.data, from: undefined, to: undefined } }
          : r,
      );
    if (!originals.length) return;
    gesture.current = {
      kind: "move",
      wx: w.x,
      wy: w.y,
      originals,
      moved: false,
      canDrop: originals.length <= 12 && originals.every((r) => r.type !== "window" && blockFromElement(r)),
    };
  }

  /** The partial eraser's reach on the board (a fixed size on screen). */
  function eraseRadius() {
    return 12 / cam.current.zoom;
  }
  /** Partial eraser: shows what's left of each stroke the eraser has touched so far. */
  function erasePartAt(g: Extract<Gesture, { kind: "erasePart" }>) {
    const r = eraseRadius();
    const [x, y] = g.path[g.path.length - 1];
    for (const row of rowsRef.current.values()) {
      if (row.type !== "stroke" || row.data.locked || g.touched.has(row.id) || row.id.includes("~")) continue;
      const b = bounds(row);
      if (x >= b.x - r && x <= b.x + b.w + r && y >= b.y - r && y <= b.y + b.h + r) g.touched.set(row.id, committedRef.current.get(row.id) ?? row);
    }
    const path = densify(g.path, r / 2);
    const updates: { id: string; row: ElementRow | null }[] = [];
    for (const [id, orig] of g.touched) {
      const pieces = eraseFromStroke(orig, path, r);
      const old = g.temp.get(id) ?? [];
      const ids = pieces.map((_, i) => `${id}~${i}`);
      for (const stale of old.filter((t) => !ids.includes(t))) dropPreview(stale);
      g.temp.set(id, ids);
      updates.push({ id, row: null });
      pieces.forEach((data, i) => updates.push({ id: ids[i], row: { ...orig, id: ids[i], data } }));
    }
    if (updates.length) preview(updates);
  }

  /** The top-most item (that arrows can attach to) at a point on the board. */
  function itemAt(x: number, y: number) {
    let best: ElementRow | null = null;
    for (const r of rowsRef.current.values()) {
      if (!ATTACHABLE(r.type)) continue;
      const b = bounds(r);
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h && (!best || r.z > best.z)) best = r;
    }
    return best?.id ?? null;
  }

  /** The ids plus everything grouped with them. */
  function withGroups(ids: string[]) {
    const groups = new Set(ids.map((id) => rowsRef.current.get(id)?.data.group).filter(Boolean));
    if (!groups.size) return ids;
    const out = new Set(ids);
    for (const r of rowsRef.current.values()) if (r.data.group && groups.has(r.data.group)) out.add(r.id);
    return [...out];
  }
  /** Copies of items, shifted by dx/dy, with fresh ids (and fresh groups, blocks and chats). */
  function cloneRows(src: ElementRow[], dx: number, dy: number) {
    const groups = new Map<string, string>();
    let z = nextZ();
    return src
      .filter((r) => r.type !== "capsule")
      .map((r) => {
        const data: ElementData = { ...r.data, x: Math.round(r.data.x + dx), y: Math.round(r.data.y + dy), likes: undefined, locked: undefined };
        if (data.group) {
          if (!groups.has(data.group)) groups.set(data.group, newId());
          data.group = groups.get(data.group);
        }
        if (data.blocks) data.blocks = data.blocks.map((b) => ({ ...b, id: newId(), votes: {} }));
        return mkRow(r.type, data, z++, me.id);
      });
  }
  function duplicateSelection() {
    const src = selectedIdsRef.current.map((id) => rowsRef.current.get(id)).filter((r): r is ElementRow => !!r);
    const copies = cloneRows(src, 32, 32);
    if (!copies.length) return;
    void send(copies.map((r) => ({ before: null, after: r })));
    setSelectedIds(copies.map((r) => r.id));
  }
  function nudgeSelection(dx: number, dy: number) {
    const rowsToMove = selectedIdsRef.current.map((id) => rowsRef.current.get(id)).filter((r): r is ElementRow => !!r && !r.data.locked);
    if (!rowsToMove.length) return;
    void send(rowsToMove.map((r) => ({ before: committedRef.current.get(r.id) ?? r, after: { ...r, data: { ...r.data, x: r.data.x + dx, y: r.data.y + dy } } })));
  }
  function toggleGroup() {
    const rowsNow = selectedIdsRef.current.map((id) => rowsRef.current.get(id)).filter((r): r is ElementRow => !!r);
    const grouped = rowsNow.length > 1 && rowsNow.every((r) => r.data.group && r.data.group === rowsNow[0].data.group);
    if (rowsNow.length < 2) return;
    const g = grouped ? undefined : newId();
    void send(rowsNow.map((r) => ({ before: committedRef.current.get(r.id) ?? r, after: { ...r, data: { ...r.data, group: g } } })));
    showToast(grouped ? "Ungrouped" : `Grouped ${rowsNow.length} things`);
  }
  function toggleLock() {
    const rowsNow = selectedIdsRef.current.map((id) => rowsRef.current.get(id)).filter((r): r is ElementRow => !!r);
    if (!rowsNow.length) return;
    const lock = !rowsNow.every((r) => r.data.locked);
    void send(rowsNow.map((r) => ({ before: committedRef.current.get(r.id) ?? r, after: { ...r, data: { ...r.data, locked: lock || undefined } } })));
  }

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
  function playSong(winId: string, blockId: string, videoId: string, title: string) {
    const url = `https://youtu.be/${videoId}`;
    const existing = [...rowsRef.current.values()].find((r) => r.type === "youtube" && r.data.queueOf === blockId);
    if (existing) {
      patch(existing.id, { videoId, title, url });
      jumpToElement(existing.id);
      return;
    }
    const win = rowsRef.current.get(winId);
    if (!win) return;
    const wb = bounds(win);
    const row = addRow("youtube", { x: Math.round(wb.x + wb.w + 40), y: Math.round(wb.y), w: 480, videoId, title, url, queueOf: blockId }, false);
    jumpToElement(row.id);
  }
  function moveBlockTo(fromId: string, blockId: string, toId: string, nearBlock: string | null) {
    const from = rowsRef.current.get(fromId);
    const to = rowsRef.current.get(toId);
    const block = from?.data.blocks?.find((b) => b.id === blockId);
    if (!from || !to || !block || from.id === to.id) return;
    void send([
      { before: committedRef.current.get(fromId) ?? from, after: { ...from, data: { ...from.data, blocks: (from.data.blocks ?? []).filter((b) => b.id !== blockId) }, updated_at: new Date() } },
      { before: committedRef.current.get(toId) ?? to, after: { ...to, data: { ...to.data, blocks: insertBlocks(to.data.blocks ?? [], [block], nearBlock) }, updated_at: new Date() } },
    ]);
  }
  /** at: where on screen it was dropped; otherwise it goes beside the window. */
  async function moveBlockOut(winId: string, blockId: string, at?: { x: number; y: number }) {
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
    if (at) {
      const p = toWorld(at.x, at.y);
      data.x = Math.round(p.x - (data.w ?? 200) / 2);
      data.y = Math.round(p.y - 20);
    } else {
      data.x = Math.round(wb.x + wb.w + 40);
      data.y = Math.round(wb.y + offset);
    }
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
        onContextMenu={onContextMenu}
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
          {draft &&
            tool === "pen" &&
            mirror > 0 &&
            mirrorTransforms(mirror, mirrorCenter.x, mirrorCenter.y).map((t, i) => {
              const data = transformData(draft, t);
              const row = { ...draft, id: `${draft.id}-m${i}`, data };
              return draft.type === "stroke" ? (
                <div key={row.id} className="el el-stroke" style={{ left: data.x, top: data.y, width: data.w, height: data.h, zIndex: 999999 }}>
                  <StrokeSvg row={row} />
                </div>
              ) : (
                <ElementView key={row.id} row={row} selected={false} editing={false} likes={0} />
              );
            })}
          {tool === "pen" && mirror > 0 && (
            <div className="mirror-guide" style={{ left: mirrorCenter.x, top: mirrorCenter.y, ["--z" as string]: camera.zoom }} data-mode={mirror} aria-hidden="true">
              <span className="mg-v" />
              {mirror >= 4 && <span className="mg-h" />}
              {mirror === 8 && (
                <>
                  <span className="mg-d1" />
                  <span className="mg-d2" />
                </>
              )}
            </div>
          )}
          <LaserLayer feeds={laserFeeds} zoom={camera.zoom} />
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
          {lasso && lasso.length > 1 && (
            <svg className="lasso-path" aria-hidden="true">
              <polygon points={lasso.map((p) => p.join(",")).join(" ")} style={{ strokeWidth: 1.5 / camera.zoom, strokeDasharray: `${6 / camera.zoom} ${4 / camera.zoom}` }} />
            </svg>
          )}
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
                  say={p.say}
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

      {selectedRows.length > 0 && selBox && !marquee && tool === "select" && !editingId && !viewOnly && (
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
            onClick={() => {
              for (const r of selectedRows) if ((r.data.likes ?? []).includes(me.id) === iLike) applyEditTo(r.id, { k: "like", user: me.id });
            }}
          >
            <Icon name="heart" size={18} filled={iLike} />
          </button>
          {selectedRows.length > 1 && <span className="sel-count">{selectedRows.length} selected</span>}
          {selectedRows.length > 1 && (
            <button
              type="button"
              className="icon-btn sm"
              aria-label={isGroup ? "Ungroup" : "Group"}
              title={isGroup ? "Ungroup (Ctrl+G)" : "Group so they move together (Ctrl+G)"}
              onClick={toggleGroup}
            >
              <Icon name={isGroup ? "ungroup" : "group"} size={18} />
            </button>
          )}
          <button
            type="button"
            className="icon-btn sm"
            aria-label={allLocked ? "Unlock" : "Lock"}
            aria-pressed={allLocked}
            title={allLocked ? "Unlock (Ctrl+Shift+L)" : "Lock in place (Ctrl+Shift+L)"}
            onClick={toggleLock}
          >
            <Icon name={allLocked ? "lock" : "unlock"} size={18} />
          </button>
          {selected?.type === "image" && !selected.data.locked && (
            <button type="button" className="icon-btn sm" aria-label="Crop and rotate" title="Crop and rotate" onClick={() => setPhotoEditId(selected.id)}>
              <Icon name="crop" size={18} />
            </button>
          )}
          <button type="button" className="icon-btn sm" aria-label="Save as a picture" title="Save as a picture" onClick={() => void exportPng(true)}>
            <Icon name="download" size={18} />
          </button>
          <button type="button" className="icon-btn sm" aria-label="Duplicate" title="Duplicate (Ctrl+D)" onClick={duplicateSelection}>
            <Icon name="copy" size={18} />
          </button>
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
          <button type="button" className="icon-btn sm" aria-label="Send to back" title="Send to back" onClick={() => sendToBack(selectedRows)}>
            <Icon name="back2" size={18} />
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
                canEdit={!viewOnly}
                canClear={canClear}
              />
              {viewOnly ? (
                <span className="pill code-chip view-chip" title="You can look around, but not change anything">
                  <Icon name="eye" size={16} /> View only
                </span>
              ) : (
                <button type="button" className="pill code-chip" onClick={copyInvite} title="Copy the invite link" aria-label={`Room code ${displayCode(boardId)}. Copy the invite link`}>
                  <span className="code-label">Code</span>
                  <span className="mono">{displayCode(boardId)}</span>
                  <Icon name="link" size={16} />
                </button>
              )}
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
                          {p.listening && (
                            <span className="listening-dot" title={`Listening to ${p.listening.title} by ${p.listening.artists}`}>
                              <Icon name="music" size={9} strokeWidth={3} />
                            </span>
                          )}
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
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Bring everyone to what you're looking at"
                  title={partnerOnline ? "Come here: bring everyone to what you're looking at" : "Nobody else is here right now"}
                  disabled={!partnerOnline || viewOnly}
                  onClick={summonEveryone}
                >
                  <Icon name="pin" />
                </button>
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
              <FocusTimer
                focus={board?.focus ?? null}
                serverNow={serverNow}
                readOnly={viewOnly}
                onChange={setFocus}
                onLofi={addLofi}
              />
              <button
                type="button"
                className="icon-btn surface theme-btn"
                aria-label="Search the board"
                title="Search (Ctrl+F)"
                aria-expanded={searchOpen}
                onClick={() => setSearchOpen((o) => !o)}
              >
                <Icon name="search" />
              </button>
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
                  disabled={viewOnly}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== board?.name) api.updateBoard(boardId, { name, from: me.id }).then(setBoard, () => showToast("Couldn't rename"));
                  }}
                />
              </div>
              {!viewOnly && (
                <div>
                  <span className="field-label">Invite code</span>
                  <button type="button" className="btn code-big" onClick={copyInvite}>
                    <span className="mono">{displayCode(boardId)}</span>
                    <span className="muted">Copy link</span>
                  </button>
                </div>
              )}
              {!viewOnly && (
                <div className="menu-actions">
                  <button type="button" className="btn" onClick={copyViewLink}>
                    <Icon name="eye" size={18} /> {board?.view_code ? "Copy view-only link" : "Make a view-only link"}
                  </button>
                  {board?.view_code && (
                    <button type="button" className="btn btn-ghost" onClick={turnOffViewLink}>
                      Turn off view-only link
                    </button>
                  )}
                </div>
              )}
              <button type="button" className="btn" onClick={() => void exportPng(false)}>
                <Icon name="download" size={18} /> Save this page as a picture
              </button>
              <button type="button" className="btn" onClick={() => void saveTimelapse()}>
                <Icon name="play" size={18} /> Save a time-lapse video
              </button>
              {!viewOnly && (
                <div className="menu-templates">
                  <span className="field-label">Page templates</span>
                  {pageTplName === null ? (
                    <button type="button" className="btn" onClick={() => setPageTplName(pages.find((p) => p.id === page)?.name ?? "")} disabled={!rows.length}>
                      <Icon name="plus" size={18} /> Save this page as a template
                    </button>
                  ) : (
                    <form
                      className="win-name-tpl"
                      onSubmit={(e) => {
                        e.preventDefault();
                        savePageTemplate();
                      }}
                    >
                      <input autoFocus className="input" aria-label="Template name" value={pageTplName} maxLength={40} onChange={(e) => setPageTplName(e.target.value)} />
                      <button type="submit" className="btn btn-primary">
                        Save
                      </button>
                    </form>
                  )}
                  {pageTemplates.map((t) => (
                    <div key={t.id} className="menu-template">
                      <button type="button" className="btn btn-ghost" title="Add it to this page" onClick={() => applyPageTemplate(t.items ?? [])}>
                        <Icon name="window" size={16} /> {t.name}
                        <span className="muted">{t.items?.length ?? 0} things</span>
                      </button>
                      <button type="button" className="icon-btn sm" aria-label={`Delete the template ${t.name}`} onClick={() => deleteTemplate(t.id)}>
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {isCreator && (
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={!!board?.settings?.creatorOnlyClear}
                    onChange={(e) =>
                      api
                        .updateBoard(boardId, { settings: { creatorOnlyClear: e.target.checked }, from: me.id })
                        .then(setBoard, (err) => showToast(err instanceof Error ? err.message : "Couldn't save that"))
                    }
                  />
                  <span>
                    <strong>Only I can clear or delete pages</strong>
                    <span className="muted">You made this room. Others can still draw and add pages.</span>
                  </span>
                </label>
              )}
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
              {!viewOnly && (
                <div className="spotify-row">
                  <span className="field-label">
                    <Icon name="music" size={14} /> Spotify
                  </span>
                  {spotifyLinked ? (
                    <>
                      <label className="toggle-row">
                        <input
                          type="checkbox"
                          checked={shareSpotify}
                          onChange={(e) => {
                            setShareSpotify(e.target.checked);
                            setSharingSpotify(e.target.checked);
                          }}
                        />
                        <span>
                          <strong>Share what I&apos;m listening to</strong>
                          <span className="muted">{myTrack ? `${myTrack.title} · ${myTrack.artists}` : shareSpotify ? "Nothing playing right now" : "Hidden from the room"}</span>
                        </span>
                      </label>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                          forgetSpotify();
                          setSpotifyLinked(false);
                        }}
                      >
                        Disconnect Spotify
                      </button>
                    </>
                  ) : (
                    <>
                      <form
                        className="spotify-card-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const id = cardIdFrom(cardDraft);
                          if (!id) return setCardError("Paste the whole link from Data Card for Spotify");
                          setSpotifyCard(id);
                          setCardDraft("");
                          setCardError(null);
                          setShareSpotify(true);
                          setSpotifyLinked(true);
                          showToast("Connected. The room sees what you're playing within a few seconds.");
                        }}
                      >
                        <input
                          className="input"
                          aria-label="Your Data Card for Spotify link"
                          placeholder="Paste your Data Card for Spotify link"
                          value={cardDraft}
                          onChange={(e) => {
                            setCardDraft(e.target.value);
                            setCardError(null);
                          }}
                        />
                        <button type="submit" className="btn btn-primary" disabled={!cardDraft.trim()}>
                          Share
                        </button>
                      </form>
                      {cardError && <span className="field-error">{cardError}</span>}
                      <span className="muted spotify-help">
                        Works with free Spotify. No link yet? Make one at{" "}
                        <a href="https://data-card-for-spotify.herokuapp.com" target="_blank" rel="noopener noreferrer">
                          Data Card for Spotify
                        </a>
                        .
                      </span>
                      <button type="button" className="btn btn-ghost" onClick={connectSpotify}>
                        Or sign in with Spotify (Premium)
                      </button>
                    </>
                  )}
                </div>
              )}
              <h3>You</h3>
              <button type="button" className="btn" style={{ justifyContent: "flex-start" }} onClick={() => setDialog({ kind: "me" })}>
                <span className="avatar" style={{ background: me.color, width: 26, height: 26 }}>
                  {initials(me.name)}
                </span>
                {me.name} · change
              </button>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                Shortcuts: V select · H pan · P draw · E erase · T text · N list · W window · Space+drag pan · Ctrl+Z undo · / say something · Ctrl+F search · Ctrl+D duplicate · Ctrl+G group · Ctrl+Shift+L lock · Ctrl+C/V copy and paste · arrows nudge
              </p>
            </div>
          )}

          {emojiFrom && <EmojiMaker taken={roomEmojis.map((e) => e.name)} onMake={makeEmoji} onClose={() => setEmojiFrom(null)} />}
          {sayOpen && (
            <div
              className="say-box"
              style={{
                left: (lastCursor.current?.x ?? 0) * camera.zoom + camera.x + 18,
                top: (lastCursor.current?.y ?? 0) * camera.zoom + camera.y + 22,
                ["--sel" as string]: me.color,
              }}
            >
              <input
                autoFocus
                aria-label="Say something next to your cursor"
                placeholder="Say something"
                value={sayText}
                maxLength={140}
                onChange={(e) => {
                  setSayText(e.target.value);
                  updateSay(e.target.value);
                }}
                onBlur={() => {
                  setSayOpen(false);
                  updateSay(sayText, 4000);
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    setSayOpen(false);
                    updateSay(sayText, 4000);
                  }
                  if (e.key === "Escape") {
                    setSayText("");
                    updateSay(null);
                    setSayOpen(false);
                  }
                }}
              />
            </div>
          )}
          {summon && <SummonBanner name={summon.name} onGo={() => goToSummon(summon)} onSkip={() => setSummon(null)} />}
          {menuAt && <ContextMenu x={menuAt.x} y={menuAt.y} items={menuAt.items} onClose={() => setMenuAt(null)} />}
          {photoEditId && rowsById.get(photoEditId) && (
            <PhotoEditor
              row={rowsById.get(photoEditId)!}
              onClose={() => setPhotoEditId(null)}
              onApply={(data) => {
                patch(photoEditId, data);
                setPhotoEditId(null);
              }}
            />
          )}
          {searchOpen && (
            <div className="hud search-hud">
              <SearchPanel rows={allRows} threads={threads} homes={threadHomes} pages={pages} onJump={jumpToHit} onClose={() => setSearchOpen(false)} />
            </div>
          )}
          {showMap && rows.length > 0 && (
            <div className="hud minimap-hud">
              <Minimap
                rows={rows}
                camera={camera}
                onHide={() => toggleMap(false)}
                onGo={(wx, wy) => {
                  zoomAnim.current = null;
                  setFollowId(null);
                  setCamera({ zoom: cam.current.zoom, x: window.innerWidth / 2 - wx * cam.current.zoom, y: window.innerHeight / 2 - wy * cam.current.zoom });
                }}
              />
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
                {!showMap && (
                  <button type="button" className="icon-btn sm" aria-label="Show the map" title="Show the map" onClick={() => toggleMap(true)}>
                    <Icon name="map" size={18} />
                  </button>
                )}
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

            <div className="dock-wrap" style={viewOnly ? { display: "none" } : undefined}>
              {stickersOpen && (
                <StickerTray
                  onClose={() => setStickersOpen(false)}
                  onPick={(s) => {
                    setStickersOpen(false);
                    void addSticker(s);
                  }}
                />
              )}
              {tool === "eraser" && !stickersOpen && (
                <div className="style-bar" role="radiogroup" aria-label="Eraser">
                  <button type="button" className="mode-btn" role="radio" aria-checked={eraserMode === "whole"} onClick={() => setEraserMode("whole")}>
                    Whole lines
                  </button>
                  <button type="button" className="mode-btn" role="radio" aria-checked={eraserMode === "part"} onClick={() => setEraserMode("part")}>
                    Just the bits I rub
                  </button>
                </div>
              )}
              {showStyle && !stickersOpen && (
                <div className="style-bar" role="group" aria-label="Style">
                  {tool === "pen" && (
                    <>
                      <div className="pen-kinds" role="radiogroup" aria-label="Pen">
                        {(
                          [
                            ["pen", "pen", "Pen"],
                            ["highlight", "highlighter", "Highlighter"],
                            ["fade", "fade", "Fading ink (gone after 12 seconds)"],
                          ] as const
                        ).map(([k, icon, label]) => (
                          <button key={k} type="button" className="icon-btn sm" role="radio" aria-checked={penKind === k} aria-label={label} title={label} onClick={() => setPenKind(k)}>
                            <Icon name={icon} size={17} />
                          </button>
                        ))}
                        <button
                          type="button"
                          className="icon-btn sm mirror-btn"
                          aria-pressed={mirror > 0}
                          aria-label={mirror ? `Mirror pen: ${mirror} ways` : "Mirror pen: off"}
                          title="Mirror pen: off, 2, 4 or 8 ways around the middle of your view"
                          onClick={() => {
                            const next = ({ 0: 2, 2: 4, 4: 8, 8: 0 } as const)[mirror];
                            if (!mirror) setMirrorCenter(centerWorld());
                            setMirror(next);
                          }}
                        >
                          <Icon name="mirror" size={17} />
                          {mirror > 0 && <span className="mirror-n">{mirror}</span>}
                        </button>
                      </div>
                      <div className="ctrl-sep" />
                    </>
                  )}
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
                  {customColors.map((c) => (
                    <button key={c} type="button" className="swatch" aria-label={`Colour ${c}`} aria-pressed={activeColor === c} style={{ background: c }} onClick={() => applyStyle({ color: c })} />
                  ))}
                  <label className="swatch swatch-add" title="Pick any colour">
                    <Icon name="plus" size={14} />
                    <input type="color" aria-label="Pick any colour" onChange={(e) => pickCustomColor(e.target.value)} />
                  </label>
                  {hasEyeDropper && (
                    <button
                      type="button"
                      className="icon-btn sm"
                      aria-label="Pick a colour from the screen"
                      title="Pick a colour from the screen"
                      onClick={async () => {
                        try {
                          const ED = (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
                          const r = await new ED().open();
                          pickCustomColor(r.sRGBHex);
                        } catch {}
                      }}
                    >
                      <Icon name="pipette" size={16} />
                    </button>
                  )}
                  <div className="ctrl-sep" />
                  {STROKE_SIZES.map((s) => (
                    <button key={s.id} type="button" className="width-btn" aria-label={s.label} aria-pressed={sizeId === s.id} onClick={() => applyStyle({ size: s.id })}>
                      <span style={{ height: s.id * 2 }} />
                    </button>
                  ))}
                  {showShapeStyle && (
                    <>
                      <div className="ctrl-sep" />
                      {(
                        [
                          ["none", "No fill"],
                          ["soft", "Soft fill"],
                          ["solid", "Solid fill"],
                        ] as const
                      ).map(([f, label]) => (
                        <button key={f} type="button" className={`fill-btn fill-${f}`} aria-label={label} title={label} aria-pressed={activeShape.fill === f} onClick={() => applyStyle({ fill: f })}>
                          <span />
                        </button>
                      ))}
                      <button
                        type="button"
                        className="fill-btn dash-btn"
                        aria-label="Dashed line"
                        title="Dashed line"
                        aria-pressed={activeShape.dashed}
                        onClick={() => applyStyle({ dashed: !activeShape.dashed })}
                      >
                        <span />
                      </button>
                      <button
                        type="button"
                        className="fill-btn opacity-btn"
                        aria-label={`See-through: ${Math.round(activeShape.opacity * 100)}%`}
                        title="How see-through it is"
                        onClick={() => applyStyle({ opacity: ({ 1: 0.75, 0.75: 0.5, 0.5: 0.25, 0.25: 1 } as Record<number, number>)[activeShape.opacity] ?? 1 })}
                      >
                        {Math.round(activeShape.opacity * 100)}%
                      </button>
                    </>
                  )}
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
              {inbox.count > 0 && (
                <button
                  type="button"
                  className={`now-pill inbox-pill${inbox.mention ? " mention" : ""}`}
                  title="Go to the unread messages"
                  onClick={jumpToUnread}
                >
                  <span className="inbox-count">{inbox.mention ? "@" : inbox.count}</span>
                  <span className="now-text">
                    <span className="now-label">{inbox.mention ? "You were mentioned" : `${inbox.count} unread`}</span>
                    <span className="now-title">{inbox.title}</span>
                  </span>
                </button>
              )}
              <NowPlaying
                items={nowPlaying}
                onJump={jumpToElement}
                onAddSong={
                  viewOnly
                    ? undefined
                    : (url) => {
                        const link = detectLink(url);
                        if (link) addLink(link).catch((err) => showToast(err.message));
                      }
                }
              />
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
