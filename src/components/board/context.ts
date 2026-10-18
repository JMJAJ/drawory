"use client";

import { createContext, useContext } from "react";
import type { Me } from "@/lib/client/identity";
import type { ElementData } from "@/lib/types";

export type YtCommand = { action: "play" | "pause"; time: number; sentAt: number };

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
  finishText(id: string, text: string): void;
  /** Shares what's being typed, so others see it letter by letter. */
  reportTyping(id: string, text: string): void;
  stopEditing(): void;
  sendYt(elementId: string, cmd: Omit<YtCommand, "sentAt">): void;
  onYt(elementId: string, handler: (cmd: YtCommand) => void): () => void;
  setWatching(elementId: string | null): void;
  openCapsule(elementId: string): void;
  addToCapsule(elementId: string): void;
}

export const BoardContext = createContext<BoardCtx | null>(null);

export function useBoard() {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error("useBoard must be used inside a board");
  return ctx;
}
