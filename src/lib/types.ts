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
  | "sticker";

export interface ElementData {
  x: number;
  y: number;
  w?: number;
  h?: number;
  color?: string;
  size?: number; // stroke width, or font size for text
  font?: string; // text font id, see FONTS
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

export interface BoardMeta {
  id: string;
  name: string;
  together_since: string | null;
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
  | { op: "delete"; id: string };

export type LiveQueryName = "elements" | "presence" | "signals";
