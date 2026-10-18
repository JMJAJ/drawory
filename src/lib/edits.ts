// Small, targeted changes to one element (a vote, a tick, a new item). The server applies them to
// the newest saved version under a row lock, so two people acting at the same moment both count.
// The browser applies the same function straight away so the change shows instantly.

import { guessPoints, NEW_GAME, type GameState } from "./game";
import type { ElementData, WinBlock, WinItem } from "./types";

export type Edit =
  /** Toggle my vote. single: one choice per person, so voting moves it. */
  | { k: "vote"; block: string; option: string; user: string; single?: boolean }
  /** Tick or untick an item (block omitted: the checklist card itself). */
  | { k: "item-toggle"; block?: string; item: string }
  | { k: "item-add"; block?: string; item: WinItem }
  | { k: "item-remove"; block?: string; item: string }
  /** Change some fields of an item (move a kanban card, set a photo…). */
  | { k: "item-set"; block?: string; item: string; set: Partial<Omit<WinItem, "id">> }
  /** Heart or un-heart the element. */
  | { k: "like"; user: string }
  /** Pictionary: join, leave, a right guess, or a step of the game (only if it's still at that round/step). */
  | { k: "game-join"; user: string; name: string; color: string }
  | { k: "game-leave"; user: string }
  | { k: "game-correct"; user: string; round: number }
  | { k: "game-set"; set: Partial<GameState>; ifRound?: number; ifStatus?: GameState["status"] };

type Items = NonNullable<WinBlock["items"]>;

function onItems(data: ElementData, block: string | undefined, fn: (items: Items) => Items): ElementData {
  if (!block) return { ...data, items: fn((data.items ?? []) as Items) as ElementData["items"] };
  return { ...data, blocks: (data.blocks ?? []).map((b) => (b.id === block ? { ...b, items: fn(b.items ?? []) } : b)) };
}

export function applyEdit(data: ElementData, e: Edit): ElementData {
  switch (e.k) {
    case "vote":
      return {
        ...data,
        blocks: (data.blocks ?? []).map((b) => {
          if (b.id !== e.block) return b;
          const had = (b.votes?.[e.option] ?? []).includes(e.user);
          const votes: Record<string, string[]> = {};
          for (const [k, list] of Object.entries(b.votes ?? {})) votes[k] = e.single || k === e.option ? list.filter((u) => u !== e.user) : list;
          if (!had) votes[e.option] = [...(votes[e.option] ?? []), e.user];
          return { ...b, votes };
        }),
      };
    case "item-toggle":
      return onItems(data, e.block, (items) => items.map((i) => (i.id === e.item ? { ...i, done: !i.done } : i)));
    case "item-add":
      return onItems(data, e.block, (items) => (items.some((i) => i.id === e.item.id) ? items : [...items, e.item]));
    case "item-remove":
      return onItems(data, e.block, (items) => items.filter((i) => i.id !== e.item));
    case "item-set":
      return onItems(data, e.block, (items) => items.map((i) => (i.id === e.item ? { ...i, ...e.set, id: i.id } : i)));
    case "like": {
      const likes = data.likes ?? [];
      return { ...data, likes: likes.includes(e.user) ? likes.filter((l) => l !== e.user) : [...likes, e.user] };
    }
    case "game-join": {
      const g = data.game ?? NEW_GAME;
      if (g.players.some((p) => p.id === e.user)) return data;
      return { ...data, game: { ...g, players: [...g.players, { id: e.user, name: e.name, color: e.color, pts: 0 }].slice(0, 20) } };
    }
    case "game-leave": {
      const g = data.game ?? NEW_GAME;
      return { ...data, game: { ...g, players: g.players.filter((p) => p.id !== e.user) } };
    }
    case "game-correct": {
      const g = data.game ?? NEW_GAME;
      const correct = g.correct ?? [];
      if (g.status !== "drawing" || g.round !== e.round || e.user === g.drawer || correct.includes(e.user)) return data;
      const pts = guessPoints(correct.length);
      return {
        ...data,
        game: {
          ...g,
          correct: [...correct, e.user],
          players: g.players.map((p) => (p.id === e.user ? { ...p, pts: p.pts + pts } : p.id === g.drawer ? { ...p, pts: p.pts + 1 } : p)),
        },
      };
    }
    case "game-set": {
      const g = data.game ?? NEW_GAME;
      if (e.ifRound !== undefined && g.round !== e.ifRound) return data;
      if (e.ifStatus !== undefined && g.status !== e.ifStatus) return data;
      return { ...data, game: { ...g, ...e.set } };
    }
  }
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

function cleanItem(raw: unknown): Partial<WinItem> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: Partial<WinItem> = {};
  if (typeof r.text === "string") out.text = r.text.slice(0, 300);
  if (typeof r.done === "boolean") out.done = r.done;
  if (typeof r.src === "string") out.src = r.src.slice(0, 1000);
  if (typeof r.col === "string") out.col = r.col.slice(0, 40);
  if (typeof r.by === "string") out.by = r.by.slice(0, 64);
  if (typeof r.amount === "number" && Number.isFinite(r.amount)) out.amount = Math.round(r.amount * 100) / 100;
  if (Array.isArray(r.split)) out.split = r.split.filter((s): s is string => typeof s === "string").slice(0, 50).map((s) => s.slice(0, 64));
  if (typeof r.url === "string") out.url = r.url.slice(0, 500);
  return out;
}

const STATUSES = ["lobby", "choosing", "drawing", "reveal"];

/** Only the game fields a browser may set, each checked. */
function cleanGameSet(raw: unknown): Partial<GameState> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: Partial<GameState> = {};
  if (typeof r.status === "string" && STATUSES.includes(r.status)) out.status = r.status as GameState["status"];
  if (Number.isInteger(r.round) && (r.round as number) >= 0) out.round = r.round as number;
  if (r.drawer === null || typeof r.drawer === "string") out.drawer = r.drawer === null ? null : (r.drawer as string).slice(0, 64);
  if (r.hash === null || (typeof r.hash === "string" && /^[0-9a-f]{64}$/.test(r.hash))) out.hash = r.hash as string | null;
  if (r.hint === null || typeof r.hint === "string") out.hint = r.hint === null ? null : (r.hint as string).slice(0, 60);
  if (r.endsAt === null || (typeof r.endsAt === "number" && Number.isFinite(r.endsAt))) out.endsAt = r.endsAt as number | null;
  if (Array.isArray(r.correct)) out.correct = r.correct.filter((x): x is string => typeof x === "string").slice(0, 20);
  if (r.lastWord === null || typeof r.lastWord === "string") out.lastWord = r.lastWord === null ? null : (r.lastWord as string).slice(0, 40);
  if (Array.isArray(r.players)) {
    out.players = r.players
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .slice(0, 20)
      .map((p) => ({
        id: String(p.id ?? "").slice(0, 64),
        name: String(p.name ?? "").slice(0, 40),
        color: String(p.color ?? "").slice(0, 20),
        pts: Number.isFinite(p.pts) ? Math.max(0, Math.round(p.pts as number)) : 0,
      }))
      .filter((p) => p.id);
  }
  return Object.keys(out).length ? out : null;
}

/** Checks an edit sent by a browser; null if it's malformed. */
export function parseEdit(raw: unknown): Edit | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const block = r.block === undefined ? undefined : str(r.block, 64);
  if (r.block !== undefined && !block) return null;
  switch (r.k) {
    case "vote": {
      const option = str(r.option, 64), user = str(r.user, 64);
      return block && option && user ? { k: "vote", block, option, user, single: r.single === true } : null;
    }
    case "item-toggle":
    case "item-remove": {
      const item = str(r.item, 64);
      return item ? { k: r.k, block: block ?? undefined, item } : null;
    }
    case "item-add": {
      const it = cleanItem(r.item);
      const id = str((r.item as Record<string, unknown> | undefined)?.id, 64);
      return it && id ? { k: "item-add", block: block ?? undefined, item: { text: "", ...it, id } } : null;
    }
    case "item-set": {
      const item = str(r.item, 64), set = cleanItem(r.set);
      return item && set ? { k: "item-set", block: block ?? undefined, item, set } : null;
    }
    case "like": {
      const user = str(r.user, 64);
      return user ? { k: "like", user } : null;
    }
    case "game-join": {
      const user = str(r.user, 64), name = str(r.name, 40), color = str(r.color, 20);
      return user && name && color ? { k: "game-join", user, name, color } : null;
    }
    case "game-leave": {
      const user = str(r.user, 64);
      return user ? { k: "game-leave", user } : null;
    }
    case "game-correct": {
      const user = str(r.user, 64);
      return user && Number.isInteger(r.round) ? { k: "game-correct", user, round: r.round as number } : null;
    }
    case "game-set": {
      const set = cleanGameSet(r.set);
      if (!set) return null;
      const ifRound = Number.isInteger(r.ifRound) ? (r.ifRound as number) : undefined;
      const ifStatus = typeof r.ifStatus === "string" && STATUSES.includes(r.ifStatus) ? (r.ifStatus as GameState["status"]) : undefined;
      return { k: "game-set", set, ifRound, ifStatus };
    }
    default:
      return null;
  }
}
