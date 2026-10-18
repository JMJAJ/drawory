"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  STROKE_COLORS,
  STROKE_SIZES,
  STYLABLE,
  FONTS,
  unionBounds,
  type Camera,
} from "@/lib/client/elements";
import { displayCode, inviteLink, rememberRoom } from "@/lib/client/rooms";
import { initials, textOn, type Me } from "@/lib/client/identity";
import { audioPeaks, detectLink, fitWithin, imageSize, shrinkPhoto, videoSize, type DetectedLink } from "@/lib/client/media";
import type { Activity, BoardMeta, ElementData, ElementRow, ElementType, PresenceRow } from "@/lib/types";
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
import { RemoteCursor } from "./RemoteCursor";
import { MemoryLane } from "./MemoryLane";
import { StickerTray } from "./StickerTray";
import { useBoardSync, type SyncStatus } from "./sync";
import type { Sticker } from "@/lib/stickers";

type Tool =
  | "hand" | "select" | "pen" | "eraser" | "rect" | "ellipse" | "arrow" | "text"
  | "note" | "sticker" | "media" | "youtube" | "voice" | "capsule";

type Change = { before: ElementRow | null; after: ElementRow | null };

type Gesture =
  // hold: on touch, keeping a finger still on empty canvas turns the pan into a selection box.
  | { kind: "pan"; sx: number; sy: number; cam: Camera; hold?: ReturnType<typeof setTimeout> }
  | { kind: "pinch"; d0: number; mx: number; my: number; cam: Camera }
  | { kind: "draw"; points: number[][] }
  | { kind: "shape"; type: "rect" | "ellipse" | "arrow"; ox: number; oy: number }
  | { kind: "move"; wx: number; wy: number; originals: ElementRow[]; moved: boolean }
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
    { id: "note", label: "Checklist", icon: "note", key: "n" },
    { id: "sticker", label: "Stickers", icon: "sticker", key: "s" },
    { id: "media", label: "Photo, video or link", icon: "image" },
    { id: "youtube", label: "Watch together", icon: "youtube" },
    { id: "voice", label: "Voice note", icon: "mic" },
    { id: "capsule", label: "Time capsule", icon: "capsule" },
  ],
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

  const committed = useMemo(() => new Map((elData ?? []).map((r) => [r.id, r])), [elData]);
  const rows = useMemo(() => {
    const map = new Map(committed);
    for (const [id, o] of overlay) {
      if (o.row) map.set(id, o.row);
      else map.delete(id);
    }
    return [...map.values()].sort((a, b) => a.z - b.z);
  }, [committed, overlay]);
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
  const [toast, setToast] = useState<{ id: number; text: string; heart?: boolean } | null>(null);
  const [hearts, setHearts] = useState<{ id: number; x: number; y: number; dx: number; delay: number }[]>([]);
  const [followId, setFollowId] = useState<string | null>(null);
  const setFollowing = (on: boolean) => !on && setFollowId(null);
  const [laneOpen, setLaneOpen] = useState(false);
  const [laneRows, setLaneRows] = useState<ElementRow[] | null>(null);
  const [board, setBoard] = useState<BoardMeta | null>(null);
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

  const showToast = useCallback((text: string, heart = false) => setToast({ id: Date.now(), text, heart }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
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
  const camKey = `drawory:cam:${boardId}`;
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
    setCamera({ x: window.innerWidth / 2, y: window.innerHeight / 2, zoom: 1 });
  }, [camKey, setCamera]);
  // First visit on this device: frame everything once the board loads.
  useEffect(() => {
    if (cameraReady || !elData) return;
    const all = unionBounds(elData);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- frame the board once its first rows arrive
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
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    [setCamera],
  );
  const centerWorld = useCallback(() => toWorld(window.innerWidth / 2, window.innerHeight / 2), [toWorld]);
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
      const row = makeRow(type, data, nextZ(), me.id);
      void send([{ before: null, after: row }]);
      if (select) setSelectedId(row.id);
      return row;
    },
    [me.id, nextZ, send, setSelectedId],
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
  const pushPresence = useCallback(
    (hidden = false, leaving = false) => {
      // One update in flight at a time; the latest state goes out as soon as it lands.
      if (presenceInflight.current && !hidden && !leaving) {
        presencePending.current = true;
        return;
      }
      presenceInflight.current = true;
      const c = cam.current;
      const sentAt = Date.now();
      void api
        .presence(boardId, {
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
          activity: hidden ? null : activityRef.current,
        }, leaving)
        .then((res) => {
          const rtt = Date.now() - sentAt;
          // Only trust quick round trips; a slow one says little about the clock.
          if (!res?.now || rtt >= 2_000) return;
          const offset = res.now - (sentAt + rtt / 2);
          const jump = Math.abs(offset - clockOffset.current) > 1_000;
          clockOffset.current = offset;
          if (jump) setNow(Date.now() + offset);
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
    [boardId, me],
  );
  useEffect(() => {
    pushPresenceRef.current = pushPresence;
  }, [pushPresence]);
  const schedulePresence = useCallback(() => {
    if (presenceTimer.current) return;
    // While actively drawing/dragging/typing, update faster so others see it smoothly.
    const busy = activityRef.current && activityRef.current.k !== "select";
    const wait = Math.max(0, (busy ? 40 : 70) - (Date.now() - lastPresence.current));
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
  useEffect(schedulePresence, [camera, tool, watching, schedulePresence]);

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
  const others = useMemo(
    () => (sync.presence ?? []).filter((p) => p.user_id !== me.id).sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime()),
    [sync.presence, me.id],
  );
  const online = useMemo(() => others.filter((p) => now - p.updated_at.getTime() < ONLINE_MS), [others, now]);
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
    return online.flatMap((p) => {
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
  }, [online, camera, vp]);

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
      if (s.from_user === me.id) continue;
      if (s.kind === "wave" || s.kind === "heart") {
        const p = othersRef.current.find((o) => o.user_id === s.from_user);
        const c = cam.current;
        const visible = p?.cursor_x != null && p.cursor_y != null;
        const x = visible ? p!.cursor_x! * c.zoom + c.x : window.innerWidth - 220;
        const y = visible ? p!.cursor_y! * c.zoom + c.y : 90;
        spawnHearts(Math.min(Math.max(x, 40), window.innerWidth - 40), Math.min(Math.max(y, 120), window.innerHeight - 40));
        showToast(`${p?.name ?? "Someone"} waved at you`, true);
      } else if (s.kind === "yt") {
        const payload = s.payload as { elementId?: string } & YtCommand;
        if (payload.elementId) ytHandlers.current.get(payload.elementId)?.forEach((h) => h(payload));
      } else if (s.kind === "board") {
        loadBoard();
      }
    }
  }, [sync.signals, me.id, spawnHearts, showToast, loadBoard]);

  function sendWave(e: React.MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    spawnHearts(r.left + r.width / 2, r.top + r.height);
    void api.signal(boardId, "wave", me.id).catch(() => showToast("Couldn't send the wave"));
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
    // Clicks inside the thing being edited go to it (placing the caret, selecting text).
    if (editingId && target.closest(`[data-el="${editingId}"]`)) return;
    if (editingId) {
      // A click away finishes what you were editing, and does nothing else.
      // Text is saved straight from the box rather than relying on the blur event.
      const editingRow = rowsRef.current.get(editingId);
      if (editingRow?.type === "text") {
        const box = rootRef.current?.querySelector<HTMLElement>(`[data-el="${editingId}"] .text-body`);
        finishText(editingId, box?.innerText ?? "");
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
            if (again && ["text", "note", "image"].includes(row.type)) {
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
          gesture.current = { kind: "move", wx: w.x, wy: w.y, originals, moved: false };
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
        setDraft(makeRow("stroke", strokeData([[w.x, w.y, pressure]]), nextZ(), me.id));
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
        const size = TEXT_SIZES[sizeId - 1] ?? 28;
        const row = makeRow("text", { x: w.x, y: w.y - size * 0.7, text: "", size, color: colorId, font: fontId }, nextZ(), me.id);
        preview([{ id: row.id, row }]);
        setEditingId(row.id);
        setActivity({ k: "typing", id: row.id, text: "", d: row.data });
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
          shapeRow = makeRow("arrow", {
            x, y, w: Math.abs(dx) + pad * 2, h: Math.abs(dy) + pad * 2, color: colorId, size: width,
            points: [[g.ox - x, g.oy - y], [g.ox + dx - x, g.oy + dy - y]],
          }, nextZ(), me.id);
        } else {
          shapeRow = makeRow(g.type, {
            x: Math.min(g.ox, g.ox + dx), y: Math.min(g.oy, g.oy + dy), w: Math.abs(dx), h: Math.abs(dy), color: colorId, size: width,
          }, nextZ(), me.id);
        }
        setDraft(shapeRow);
        setActivity({ k: "shape", t: g.type, d: shapeRow.data });
        break;
      }
      case "move": {
        const dx = w.x - g.wx;
        const dy = w.y - g.wy;
        if (!g.moved && Math.hypot(dx, dy) * cam.current.zoom < 3) break;
        g.moved = true;
        preview(g.originals.map((r) => ({ id: r.id, row: { ...r, data: { ...r.data, x: Math.round(r.data.x + dx), y: Math.round(r.data.y + dy) } } })));
        setActivity({ k: "move", items: g.originals.slice(0, 150).map((r) => [r.id, Math.round(r.data.x + dx), Math.round(r.data.y + dy)]) });
        break;
      }
      case "resize": {
        const r = g.original;
        const b = bounds(r);
        const mode = RESIZABLE[r.type];
        const nw = Math.max(40, b.w + (w.x - g.wx));
        let nh = Math.max(30, b.h + (w.y - g.wy));
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
        if (g.moved) {
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
    if (row && ["text", "note", "image"].includes(row.type)) setEditingId(row.id);
  }

  // Wheel: pinch-zoom on trackpads (ctrl) and ctrl/cmd+wheel zoom, plain wheel pans.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest(".dialog, .menu-panel")) return;
      e.preventDefault();
      setFollowing(false);
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX, e.clientY, cam.current.zoom * Math.exp(-e.deltaY * 0.01));
      } else {
        const c = cam.current;
        setCamera({ ...c, x: c.x - (e.shiftKey ? e.deltaY : e.deltaX), y: c.y - (e.shiftKey ? 0 : e.deltaY) });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, setCamera]);

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
        zoomAt(window.innerWidth / 2, window.innerHeight / 2, cam.current.zoom * 1.2);
      } else if (mod && e.key === "-") {
        e.preventDefault();
        zoomAt(window.innerWidth / 2, window.innerHeight / 2, cam.current.zoom / 1.2);
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
        const size = TEXT_SIZES[sizeId - 1] ?? 28;
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
    for (const p of online) if (p.watching) (map[p.watching] ??= []).push(p.name);
    return map;
  }, [online]);
  const sendYt = useCallback(
    (elementId: string, cmd: Omit<YtCommand, "sentAt">) => {
      void api.signal(boardId, "yt", me.id, { elementId, ...cmd, sentAt: serverNow() }).catch(() => {});
    },
    [boardId, me.id, serverNow],
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
      stopEditing: () => setEditingId(null),
      sendYt,
      onYt,
      setWatching: setWatchingState,
      openCapsule: (id) => setDialog({ kind: "capsuleOpen", id, title: rowsRef.current.get(id)?.data.title || "Time capsule" }),
      addToCapsule: (id) => setDialog({ kind: "capsuleNote", id }),
    }),
    [boardId, me, laneOpen, camera.zoom, watchers, serverNow, patch, finishText, reportTyping, sendYt, onYt, setEditingId],
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
    for (const p of online) {
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
  }, [online, rowsById]);

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
  const displayRows = laneOpen ? laneRows ?? [] : liveRows;
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
  const status = sync.status;
  const selBox = selectedRows.length ? unionBounds(selectedRows) : null;
  const iLike = selectedRows.length > 0 && selectedRows.every((r) => r.data.likes?.includes(me.id));

  function applyStyle(next: { color?: string; size?: number; font?: string }) {
    if (next.color) setColorId(next.color);
    if (next.size) setSizeId(next.size);
    if (next.font) setFontId(next.font);
    if (tool !== "select" || !stylable.length) return;
    const changes = stylable.flatMap((r) => {
      const data: Partial<ElementData> = {};
      if (next.color) data.color = next.color;
      if (next.font && r.type === "text") data.font = next.font;
      if (next.size) {
        if (r.type === "text") data.size = TEXT_SIZES[next.size - 1];
        else if (r.type !== "stroke") data.size = SHAPE_WIDTHS[next.size - 1]; // stroke width is baked into its shape
      }
      if (!Object.keys(data).length) return [];
      return [{ before: committedRef.current.get(r.id) ?? r, after: { ...r, data: { ...r.data, ...data } } }];
    });
    void send(changes);
  }

  function changeAll(fn: (r: ElementRow) => ElementRow) {
    void send(selectedRows.map((r) => ({ before: committedRef.current.get(r.id) ?? r, after: fn(r) })));
  }

  function fitAll() {
    const all = unionBounds(rows);
    if (all) flyTo(cameraFor(all, window.innerWidth, window.innerHeight));
    else flyTo({ x: window.innerWidth / 2, y: window.innerHeight / 2, zoom: 1 });
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
            online.map((p) =>
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
          {selected && ["text", "note", "image"].includes(selected.type) && (
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
                <button type="button" className="icon-btn sm zoom-step" aria-label="Zoom out" onClick={() => zoomAt(window.innerWidth / 2, window.innerHeight / 2, camera.zoom / 1.25)}>
                  <Icon name="minus" size={18} />
                </button>
                <button type="button" className="zoom-label" aria-label="Fit everything" title="Fit everything" onClick={fitAll}>
                  {Math.round(camera.zoom * 100)}%
                </button>
                <button type="button" className="icon-btn sm zoom-step" aria-label="Zoom in" onClick={() => zoomAt(window.innerWidth / 2, window.innerHeight / 2, camera.zoom * 1.25)}>
                  <Icon name="plus" size={18} />
                </button>
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
              <button
                type="button"
                className="status-pill"
                role="status"
                disabled={status === "live"}
                title={STATUS[status].title}
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
