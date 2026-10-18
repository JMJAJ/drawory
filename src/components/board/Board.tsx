"use client";

import type { SealedLiveQuery } from "@neon/realtime/client";
import { useLiveQuery } from "@neon/realtime-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { api } from "@/lib/client/api";
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
  unionBounds,
  type Camera,
} from "@/lib/client/elements";
import { initials, textOn, type Me } from "@/lib/client/identity";
import { audioPeaks, detectLink, fitWithin, imageSize, videoSize, type DetectedLink } from "@/lib/client/media";
import type { BoardMeta, ElementData, ElementRow, ElementType, PresenceRow, SignalRow } from "@/lib/types";
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
import { ElementView, StrokeSvg } from "./ElementView";
import { MemoryLane } from "./MemoryLane";
import { StickerTray } from "./StickerTray";
import type { Sticker } from "@/lib/stickers";

type Tool =
  | "hand" | "select" | "pen" | "eraser" | "rect" | "ellipse" | "arrow" | "text"
  | "note" | "sticker" | "media" | "youtube" | "voice" | "capsule";

type Change = { before: ElementRow | null; after: ElementRow | null };

type Gesture =
  | { kind: "pan"; sx: number; sy: number; cam: Camera }
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

export interface Sealed {
  elements: SealedLiveQuery<ElementRow>;
  presence: SealedLiveQuery<PresenceRow>;
  signals: SealedLiveQuery<SignalRow>;
}

function isEditable(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

function relativeTime(date: Date) {
  const s = (Date.now() - date.getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function Board({ boardId, me, onChangeMe, sealed }: { boardId: string; me: Me; onChangeMe: (me: Me) => void; sealed: Sealed }) {
  /* ---------- Live data ---------- */
  const refreshElements = useCallback(() => api.seal<ElementRow>(boardId, "elements"), [boardId]);
  const refreshPresence = useCallback(() => api.seal<PresenceRow>(boardId, "presence"), [boardId]);
  const refreshSignals = useCallback(() => api.seal<SignalRow>(boardId, "signals"), [boardId]);
  const elQ = useLiveQuery(sealed.elements, { refreshQuery: refreshElements });
  const prQ = useLiveQuery(sealed.presence, { refreshQuery: refreshPresence });
  const sgQ = useLiveQuery(sealed.signals, { refreshQuery: refreshSignals });

  // Optimistic overlay: local changes show instantly and drop once the live query confirms them.
  const [overlay, setOverlay] = useState(() => new Map<string, { row: ElementRow | null; v: number }>());
  const versionCounter = useRef(0);

  const committed = useMemo(() => new Map((elQ.data ?? []).map((r) => [r.id, r])), [elQ.data]);
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
  const [tool, setTool] = useState<Tool>("pen");
  const [colorId, setColorId] = useState("ink");
  const [sizeId, setSizeId] = useState(2);
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
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [watching, setWatchingState] = useState<string | null>(null);

  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const undoStack = useRef<Change[][]>([]);
  const redoStack = useRef<Change[][]>([]);
  const ytHandlers = useRef(new Map<string, Set<(c: YtCommand) => void>>());
  const lastCursor = useRef<{ x: number; y: number } | null>(null);

  const showToast = useCallback((text: string, heart = false) => setToast({ id: Date.now(), text, heart }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

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
    api.board(boardId).then(setBoard, () => {});
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
    if (cameraReady || !elQ.data) return;
    const all = unionBounds(elQ.data);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- frame the board once its first rows arrive
    if (all) setCamera(cameraFor(all, window.innerWidth, window.innerHeight));
    setCameraReady(true);
  }, [cameraReady, elQ.data, setCamera]);
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
  const elUtils = elQ.utils;
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
          const res = await api.applyOps(boardId, ops.slice(i, i + 200), me.id);
          if (res.txid) await elUtils.awaitTxId(res.txid, 10_000).catch(() => {});
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
    [boardId, me.id, elUtils, showToast],
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
  const pushPresence = useCallback(
    (hidden = false) => {
      const c = cam.current;
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
        })
        .catch(() => {});
    },
    [boardId, me],
  );
  const schedulePresence = useCallback(() => {
    if (presenceTimer.current) return;
    const wait = Math.max(0, 90 - (Date.now() - lastPresence.current));
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
    const onLeave = () => pushPresence(true);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onLeave);
    return () => {
      clearInterval(beat);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onLeave);
    };
  }, [pushPresence]);
  useEffect(schedulePresence, [camera, tool, watching, schedulePresence]);

  // Everyone else who has ever opened this board, most recently active first.
  const others = useMemo(
    () => (prQ.data ?? []).filter((p) => p.user_id !== me.id).sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime()),
    [prQ.data, me.id],
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

  // Follow someone's view: keep the same world centre and zoom as them.
  const followed = followId ? online.find((p) => p.user_id === followId) ?? null : null;
  const followActive = !!followed;
  useEffect(() => {
    if (!followed) return;
    const z = clampZoom(followed.zoom);
    const cx = (followed.view_w / 2 - followed.view_x) / followed.zoom;
    const cy = (followed.view_h / 2 - followed.view_y) / followed.zoom;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors their camera as their presence row changes
    setCamera({ zoom: z, x: window.innerWidth / 2 - cx * z, y: window.innerHeight / 2 - cy * z });
  }, [followed, setCamera]);

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
    const data = sgQ.data;
    if (!data) return;
    if (!seenSignals.current) {
      seenSignals.current = new Set(data.map((s) => s.id));
      return;
    }
    for (const s of [...data].reverse()) {
      if (seenSignals.current.has(s.id)) continue;
      seenSignals.current.add(s.id);
      if (s.from_user === me.id) continue;
      if (s.kind === "heart") {
        const p = othersRef.current.find((o) => o.user_id === s.from_user);
        const c = cam.current;
        const visible = p?.cursor_x != null && p.cursor_y != null;
        const x = visible ? p!.cursor_x! * c.zoom + c.x : window.innerWidth - 220;
        const y = visible ? p!.cursor_y! * c.zoom + c.y : 90;
        spawnHearts(Math.min(Math.max(x, 40), window.innerWidth - 40), Math.min(Math.max(y, 120), window.innerHeight - 40));
        showToast(`${p?.name ?? "Someone"} sent you a heart`, true);
      } else if (s.kind === "yt") {
        const payload = s.payload as { elementId?: string } & YtCommand;
        if (payload.elementId) ytHandlers.current.get(payload.elementId)?.forEach((h) => h(payload));
      } else if (s.kind === "board") {
        loadBoard();
      }
    }
  }, [sgQ.data, me.id, spawnHearts, showToast, loadBoard]);

  function sendHeart(e: React.MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    spawnHearts(r.left + r.width / 2, r.top + r.height);
    void api.signal(boardId, "heart", me.id).catch(() => showToast("Couldn't send the heart"));
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
      for (const file of files) {
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
    if (res.txid) await elUtils.awaitTxId(res.txid, 10_000).catch(() => {});
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
      if (hits.length) preview(hits);
    },
    [preview],
  );

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

    if (pointers.current.size === 2) {
      // Second finger: switch to pinch zoom, discarding a stroke in progress.
      const [a, b] = [...pointers.current.values()];
      setDraft(null);
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
        gesture.current = { kind: "marquee", wx: w.x, wy: w.y, base };
        return;
      }
      case "pen": {
        const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
        gesture.current = { kind: "draw", points: [[w.x, w.y, pressure]] };
        setDraft(makeRow("stroke", strokeData([[w.x, w.y, pressure]]), nextZ(), me.id));
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
        const existing = elId ? rowsRef.current.get(elId) : null;
        if (existing?.type === "text") {
          setEditingId(existing.id);
          return;
        }
        const size = TEXT_SIZES[sizeId - 1] ?? 28;
        const row = makeRow("text", { x: w.x, y: w.y - size * 0.7, text: "", size, color: colorId }, nextZ(), me.id);
        preview([{ id: row.id, row }]);
        setEditingId(row.id);
        return;
      }
      case "note": {
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
        if (g.type === "arrow") {
          const pad = 20;
          const x = Math.min(g.ox, g.ox + dx) - pad;
          const y = Math.min(g.oy, g.oy + dy) - pad;
          setDraft(
            makeRow("arrow", {
              x, y, w: Math.abs(dx) + pad * 2, h: Math.abs(dy) + pad * 2, color: colorId, size: width,
              points: [[g.ox - x, g.oy - y], [g.ox + dx - x, g.oy + dy - y]],
            }, nextZ(), me.id),
          );
        } else {
          setDraft(
            makeRow(g.type, {
              x: Math.min(g.ox, g.ox + dx), y: Math.min(g.oy, g.oy + dy), w: Math.abs(dx), h: Math.abs(dy), color: colorId, size: width,
            }, nextZ(), me.id),
          );
        }
        break;
      }
      case "move": {
        const dx = w.x - g.wx;
        const dy = w.y - g.wy;
        if (!g.moved && Math.hypot(dx, dy) * cam.current.zoom < 3) break;
        g.moved = true;
        preview(g.originals.map((r) => ({ id: r.id, row: { ...r, data: { ...r.data, x: Math.round(r.data.x + dx), y: Math.round(r.data.y + dy) } } })));
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
        break;
      }
      case "erase":
        eraseAt(e.clientX, e.clientY, g);
        break;
      case "marquee": {
        const box = { x: Math.min(g.wx, w.x), y: Math.min(g.wy, w.y), w: Math.abs(w.x - g.wx), h: Math.abs(w.y - g.wy) };
        if (box.w * cam.current.zoom < 3 && box.h * cam.current.zoom < 3) break;
        setMarquee(box);
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
    switch (g.kind) {
      case "draw": {
        setDraft(null);
        const end = toWorld(e.clientX, e.clientY);
        const last = g.points[g.points.length - 1];
        if (Math.hypot(end.x - last[0], end.y - last[1]) > 0.5) g.points.push([end.x, end.y, last[2]]);
        if (g.points.length === 1) g.points.push([g.points[0][0] + 0.1, g.points[0][1] + 0.1, 0.5]);
        addRow("stroke", strokeData(g.points), false);
        break;
      }
      case "shape": {
        const d = draftRef.current;
        setDraft(null);
        const big = d && (d.type === "arrow" ? Math.hypot(d.data.w ?? 0, d.data.h ?? 0) > 50 : (d.data.w ?? 0) > 6 && (d.data.h ?? 0) > 6);
        if (d && big) void send([{ before: null, after: { ...d, id: newId() } }]);
        break;
      }
      case "move":
        if (g.moved) {
          void send(
            g.originals.map((r) => ({ before: committedRef.current.get(r.id) ?? r, after: rowsRef.current.get(r.id) ?? r })),
          );
        }
        break;
      case "resize": {
        const after = rowsRef.current.get(g.original.id);
        if (after) void send([{ before: committedRef.current.get(after.id) ?? g.original, after }]);
        break;
      }
      case "erase":
        if (g.originals.size) void send([...g.originals.values()].map((r) => ({ before: r, after: null })));
        break;
      case "marquee":
        setMarquee(null);
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
        addRow("text", { ...placeNear(text.length * size * 0.5, size), text: text.slice(0, 5000), size, color: colorId });
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
      void api.signal(boardId, "yt", me.id, { elementId, ...cmd, sentAt: Date.now() }).catch(() => {});
    },
    [boardId, me.id],
  );
  const onYt = useCallback((elementId: string, handler: (c: YtCommand) => void) => {
    const map = ytHandlers.current;
    if (!map.has(elementId)) map.set(elementId, new Set());
    map.get(elementId)!.add(handler);
    return () => {
      map.get(elementId)?.delete(handler);
    };
  }, []);
  const finishText = useCallback(
    (id: string, text: string) => {
      if (editingRef.current !== id) return; // already finished
      setEditingId(null);
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
    [send, dropPreview, setEditingId],
  );
  const ctx: BoardCtx = useMemo(
    () => ({
      boardId,
      me,
      readOnly: laneOpen,
      zoom: camera.zoom,
      watchers,
      patch,
      finishText,
      stopEditing: () => setEditingId(null),
      sendYt,
      onYt,
      setWatching: setWatchingState,
      openCapsule: (id) => setDialog({ kind: "capsuleOpen", id, title: rowsRef.current.get(id)?.data.title || "Time capsule" }),
      addToCapsule: (id) => setDialog({ kind: "capsuleNote", id }),
    }),
    [boardId, me, laneOpen, camera.zoom, watchers, patch, finishText, sendYt, onYt, setEditingId],
  );

  /* ---------- Render ---------- */
  const displayRows = laneOpen ? laneRows ?? [] : rows;
  const placesLayer = displayRows.filter((r) => r.type === "place");
  const contentLayer = displayRows.filter((r) => r.type !== "place");
  const selectedRows = laneOpen ? [] : selectedIds.map((id) => rowsById.get(id)).filter((r): r is ElementRow => !!r);
  const selected = selectedRows.length === 1 ? selectedRows[0] : null;
  const stylable = selectedRows.filter((r) => STYLABLE.includes(r.type));
  const showStyle = !laneOpen && (DRAW_TOOLS.includes(tool) || (tool === "select" && stylable.length > 0));
  const activeColor = tool === "select" && stylable[0]?.data.color ? stylable[0].data.color : colorId;
  const status = elQ.status;
  const togetherDays = board?.together_since
    ? Math.floor((now - new Date(`${board.together_since}T00:00:00`).getTime()) / 86_400_000) + 1
    : null;
  const selBox = selectedRows.length ? unionBounds(selectedRows) : null;
  const iLike = selectedRows.length > 0 && selectedRows.every((r) => r.data.likes?.includes(me.id));

  function applyStyle(next: { color?: string; size?: number }) {
    if (next.color) setColorId(next.color);
    if (next.size) setSizeId(next.size);
    if (tool !== "select" || !stylable.length) return;
    const changes = stylable.flatMap((r) => {
      const data: Partial<ElementData> = {};
      if (next.color) data.color = next.color;
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
        onPointerLeave={() => {
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
            />
          ))}
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
                <div key={p.user_id} className="cursor" style={{ transform: `translate(${p.cursor_x}px, ${p.cursor_y}px) scale(${1 / camera.zoom})` }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 3l7 18 2.6-7.4L21 11z" fill={p.color} stroke="var(--surface)" strokeWidth="1.5" strokeLinejoin="round" />
                  </svg>
                  <div className="cursor-label" style={{ background: p.color, color: textOn(p.color) }}>
                    {p.name}
                    {p.tool === "pen" ? " · drawing" : p.tool === "eraser" ? " · erasing" : ""}
                  </div>
                </div>
              ),
            )}
        </div>

        {dropping && <div className="drop-hint">Drop to add to the board</div>}
      </div>

      {/* Hearts float over everything. */}
      <div className="hearts" style={{ left: 0, top: 0 }} aria-hidden="true">
        {hearts.map((h) => (
          <div
            key={h.id}
            className="heart-float"
            style={{ left: h.x - 11, top: h.y - 11, animationDelay: `${h.delay}ms`, ["--dx" as string]: `${h.dx}px` }}
          >
            <Icon name="heart" size={22} filled />
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
            <button type="button" className="icon-btn sm" aria-label="Edit" onClick={() => setEditingId(selected.id)}>
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
                  <span>{board?.name && board.name !== "Our universe" ? board.name : "drawory"}</span>
                </div>
              </div>
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

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className="pill partner">
                <div className="partner-avatars">
                  <span className="avatar" title={`${me.name} (you)`} style={{ background: me.color, color: textOn(me.color) }}>
                    {initials(me.name)}
                  </span>
                  <Icon name="heart" size={12} filled style={{ color: "var(--accent)" }} />
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
                          ? `${partner.name} was here ${relativeTime(partner.updated_at)}`
                          : "Waiting for your person"}
                  </strong>
                  <span>{togetherDays ? `day ${togetherDays} of us` : "set your day one in the menu"}</span>
                </div>
                <button type="button" className="icon-btn heart-btn" aria-label={online.length > 1 ? "Send everyone a heart" : `Send ${partner?.name ?? "them"} a heart`} title="Send a heart" onClick={sendHeart}>
                  <Icon name="heart" filled />
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
                className="icon-btn surface"
                style={{ width: 52, height: 52, borderRadius: 16 }}
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
              <h3>Board</h3>
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
                <label className="field-label" htmlFor="board-since">
                  Together since
                </label>
                <input
                  id="board-since"
                  className="input"
                  type="date"
                  defaultValue={board?.together_since ?? ""}
                  key={board?.together_since ?? "none"}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) =>
                    api.updateBoard(boardId, { together_since: e.target.value || null, from: me.id }).then(setBoard, () => showToast("Couldn't save the date"))
                  }
                />
              </div>
              <h3>You</h3>
              <button type="button" className="btn" style={{ justifyContent: "flex-start" }} onClick={() => setDialog({ kind: "me" })}>
                <span className="avatar" style={{ background: me.color, width: 26, height: 26 }}>
                  {initials(me.name)}
                </span>
                {me.name} · change
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ justifyContent: "flex-start", color: "var(--muted)" }}
                onClick={() => api.logout().then(() => (window.location.href = "/login"))}
              >
                Sign out on this device
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
                <button type="button" className="icon-btn sm" aria-label="Zoom out" onClick={() => zoomAt(window.innerWidth / 2, window.innerHeight / 2, camera.zoom / 1.25)}>
                  <Icon name="minus" size={18} />
                </button>
                <button type="button" className="zoom-label" aria-label="Fit everything" title="Fit everything" onClick={fitAll}>
                  {Math.round(camera.zoom * 100)}%
                </button>
                <button type="button" className="icon-btn sm" aria-label="Zoom in" onClick={() => zoomAt(window.innerWidth / 2, window.innerHeight / 2, camera.zoom * 1.25)}>
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
              <div className="status-pill" role="status">
                <span className={`dot${status === "live" ? "" : status === "error" ? " bad" : " warn"}`} />
                {status === "live" ? "Live" : status === "error" ? "Offline, reload" : "Connecting…"}
              </div>
              <button type="button" className="lane-btn" onClick={() => setLaneOpen(true)}>
                <Icon name="history" size={18} />
                <span>Memory lane</span>
              </button>
            </div>
          </div>
        </>
      )}

      {toast && (
        <div className="toast" role="status" key={toast.id}>
          {toast.heart && <Icon name="heart" size={16} filled style={{ color: "var(--accent)" }} />}
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
            if (res.txid) await elUtils.awaitTxId(res.txid, 10_000).catch(() => {});
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
