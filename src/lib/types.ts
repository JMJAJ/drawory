// Shapes shared by the browser and the server.

export type ElementType =
  | "stroke"
  | "rect"
  | "ellipse"
  | "arrow"
  | "text"
  | "note"
  | "image"
  | "video"
  | "audio"
  | "youtube"
  | "embed"
  | "link"
  | "capsule"
  | "place"
  | "sticker"
  | "chatbox"
  | "sticky"
  | "window";

export interface ElementData {
  x: number;
  y: number;
  w?: number;
  h?: number;
  color?: string;
  size?: number; // stroke width, or font size for text
  font?: string; // text font id, see FONTS
  page?: string; // which page of the room it's on; none = "main"
  dashed?: boolean;
  points?: number[][]; // stroke: [x, y, pressure] relative to x/y; arrow: [[0,0],[dx,dy]]
  text?: string;
  title?: string;
  items?: { id: string; text: string; done: boolean }[];
  src?: string;
  caption?: string;
  videoId?: string;
  provider?: string;
  url?: string;
  description?: string;
  image?: string;
  site?: string;
  peaks?: number[];
  duration?: number;
  fromName?: string;
  unlockAt?: string;
  sealedByName?: string;
  count?: number;
  name?: string;
  likes?: string[];
  subtitle?: string;
  blocks?: WinBlock[];
}

/** One entry in a block: an option, a list item, a card, an expense or a song. */
export interface WinItem {
  id: string;
  text: string;
  done?: boolean;
  src?: string;
  /** Kanban column. */
  col?: string;
  /** Who added it, or who paid (bills). */
  by?: string;
  amount?: number;
  /** Bills: who shares the cost (names). */
  split?: string[];
  url?: string;
}

export type WinBlockKind = "ranking" | "list" | "poll" | "chat" | "countdown" | "text" | "link" | "image" | "divider" | "slot";

/** One block in a window. Width is in sixths of the window; the window grows to fit its blocks. */
export interface WinBlock {
  id: string;
  kind: WinBlockKind;
  title?: string;
  span?: 2 | 3 | 4 | 6;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  /** Ranking options, poll options, list items, kanban cards, expenses, songs. */
  items?: WinItem[];
  /** Who voted for what: option id -> user ids. */
  votes?: Record<string, string[]>;
  /** Countdown target (ISO time). */
  at?: string;
  text?: string;
  url?: string;
  src?: string;
}

/** A row of the `elements` live query. */
export interface ElementRow {
  id: string;
  type: ElementType;
  data: ElementData;
  z: number;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

/** A row of the `presence` live query. */
export interface PresenceRow {
  user_id: string;
  name: string;
  color: string;
  cursor_x: number | null;
  cursor_y: number | null;
  view_x: number;
  view_y: number;
  view_w: number;
  view_h: number;
  zoom: number;
  tool: string | null;
  watching: string | null;
  page: string | null;
  activity: Activity | null;
  updated_at: Date;
}

/**
 * What someone is doing right now, shared through presence so others see it as it happens.
 * Coordinates are in board (world) units.
 */
export type Activity =
  | { k: "select"; ids: string[] }
  | { k: "marquee"; b: [number, number, number, number] }
  | { k: "draw"; pts: number[][]; c: string; s: number }
  | { k: "shape"; t: "rect" | "ellipse" | "arrow"; d: ElementData }
  | { k: "move"; items: [string, number, number][] }
  | { k: "resize"; id: string; d: Partial<ElementData> }
  | { k: "typing"; id: string; text: string; d: ElementData }
  | { k: "erase"; ids: string[] };

/** A row of the `signals` live query. int8 ids arrive as strings. */
export interface SignalRow {
  id: string;
  kind: "wave" | "heart" | "yt" | "board";
  from_user: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

export interface BoardPage {
  id: string;
  name: string;
}

export interface BoardMeta {
  id: string;
  name: string;
  pages: BoardPage[];
}

export interface HistoryEvent {
  id: string;
  element_id: string;
  op: "upsert" | "delete";
  type: ElementType | null;
  data: ElementData | null;
  z: number | null;
  author: string | null;
  created_at: string;
}

export type ElementOp =
  | { op: "upsert"; id: string; type: ElementType; data: ElementData; z: number }
  | { op: "delete"; id: string }
  | { op: "edit"; id: string; edit: import("./edits").Edit };

export type LiveQueryName = "elements" | "presence" | "signals" | "chat";

/** A row of the `chat` live query. int8 ids arrive as strings. */
export interface ChatRow {
  id: string;
  /** The chat box it belongs to; null for the room chat. */
  thread: string | null;
  user_id: string;
  name: string;
  color: string;
  body: string;
  created_at: Date;
}
