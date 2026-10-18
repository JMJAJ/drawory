// Small, targeted changes to one element (a vote, a tick, a new item). The server applies them to
// the newest saved version under a row lock, so two people acting at the same moment both count.
// The browser applies the same function straight away so the change shows instantly.

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
  | { k: "like"; user: string };

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
    default:
      return null;
  }
}
