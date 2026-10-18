"use client";

import { useSyncExternalStore } from "react";
import type { ElementData, ElementType, WinBlock } from "@/lib/types";

/** A window or a whole page someone saved to reuse. Kept on this device, so it works in every room. */
export interface SavedTemplate {
  id: string;
  kind: "window" | "page";
  name: string;
  savedAt: number;
  window?: { title?: string; subtitle?: string; w?: number; blocks: WinBlock[] };
  /** Page templates: the items, with positions relative to the top-left of the page's content. */
  items?: { type: ElementType; data: ElementData }[];
}

const KEY = "drawory:templates";
const EVENT = "drawory:templates";
const EMPTY: SavedTemplate[] = [];
let cache: { raw: string | null; list: SavedTemplate[] } = { raw: null, list: EMPTY };

function read(): SavedTemplate[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {}
  if (raw === cache.raw) return cache.list;
  let list: SavedTemplate[] = EMPTY;
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) list = parsed;
  } catch {}
  cache = { raw, list };
  return list;
}

function write(list: SavedTemplate[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    throw new Error("There's no room left to save templates on this device.");
  }
  window.dispatchEvent(new Event(EVENT));
}

export function saveTemplate(t: Omit<SavedTemplate, "id" | "savedAt">) {
  write([{ ...t, id: crypto.randomUUID(), savedAt: Date.now() }, ...read()].slice(0, 60));
}

export function deleteTemplate(id: string) {
  write(read().filter((t) => t.id !== id));
}

/** A window's blocks made ready to save: no votes, nothing ticked. */
export function templateBlocks(blocks: readonly WinBlock[]): WinBlock[] {
  return blocks.map((b) => ({ ...b, votes: {}, items: b.kind === "chat" ? undefined : b.items?.map((i) => ({ ...i, done: false })) }));
}

/** Fresh ids so a template can be used many times (and chat blocks start empty). */
export function freshBlocks(blocks: readonly WinBlock[]): WinBlock[] {
  return blocks.map((b) => ({ ...b, id: crypto.randomUUID(), votes: {} }));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useTemplates(kind: SavedTemplate["kind"]) {
  const all = useSyncExternalStore(subscribe, read, () => EMPTY);
  return all.filter((t) => t.kind === kind);
}
