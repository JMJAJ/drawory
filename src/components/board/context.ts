"use client";

import { createContext, useContext } from "react";
import type { Me } from "@/lib/client/identity";
import type { Listener } from "@/lib/client/proximity";
import type { Edit } from "@/lib/edits";
import type { ChatRow, ElementData } from "@/lib/types";

/** play/pause: someone pressed it. tick: the person in charge says where playback is (every few seconds). */
export type YtCommand = { action: "play" | "pause" | "tick"; time: number; sentAt: number };

export interface BoardCtx {
  boardId: string;
  me: Me;
  readOnly: boolean;
  zoom: number;
  /** Names of other people currently playing each YouTube element, keyed by element id. */
  watchers: Record<string, string[]>;
  /** Date.now() corrected to the server's clock, for timing shared between devices. */
  serverNow(): number;
  /** Change an element. commit=false only updates this screen (used while typing or dragging). */
  patch(id: string, data: Partial<ElementData>, commit?: boolean): void;
  /** A vote, tick or new item, merged on the server with what others did at the same time. */
  edit(id: string, e: Edit): void;
  finishText(id: string, text: string): void;
  /** Messages in a chat box on the board (newest first). */
  chatFor(thread: string): readonly ChatRow[];
  /** Adds or removes my reaction on a message. */
  react(messageId: string, emoji: string): void;
  /** The conversation was on screen up to this message. */
  markSeen(thread: string, newestId: string): void;
  /** Messages from others I haven't seen in a conversation, and whether one mentions me. */
  unread(thread: string): Unread;
  /** People online to @mention. */
  people: readonly { name: string; color: string }[];
  /** A message to scroll to and flash ("jump to message"). */
  highlightMsg: string | null;
  /** Sends a message to a chat box (thread = its id) or the room chat (null). */
  sendChat(thread: string | null, body: string): Promise<{ id: string }>;
  /** Shares what's being typed, so others see it letter by letter. */
  reportTyping(id: string, text: string): void;
  stopEditing(): void;
  /** Opens an element for editing (a window's Edit button). */
  startEditing(id: string): void;
  /** Takes a block out of a window and puts it on the board beside it. */
  moveBlockOut(windowId: string, blockId: string, at?: { x: number; y: number }): void;
  /** Moves a block from one window into another (next to a block there, or to its end). */
  moveBlockTo(fromWindow: string, blockId: string, toWindow: string, nearBlock: string | null): void;
  /** Plays a song from a window's music queue in a Watch together card beside the window. */
  playSong(windowId: string, blockId: string, videoId: string, title: string): void;
  sendYt(elementId: string, cmd: Omit<YtCommand, "sentAt">): void;
  onYt(elementId: string, handler: (cmd: YtCommand) => void): () => void;
  setWatching(elementId: string | null): void;
  /** Where I am on the board (for proximity audio). Calls back now and whenever it changes. */
  onListener(cb: (at: Listener, enabled: boolean) => void): () => void;
  openCapsule(elementId: string): void;
  /** Opens crop and rotate for a photo. */
  editPhoto(elementId: string): void;
  addToCapsule(elementId: string): void;
}

export type Unread = { count: number; mention: boolean; firstId: string | null };

export const BoardContext = createContext<BoardCtx | null>(null);

export function useBoard() {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error("useBoard must be used inside a board");
  return ctx;
}
