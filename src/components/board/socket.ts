"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PresenceRow } from "@/lib/types";

// The room's live relay: cursors, live activity, waves and video sync arrive in tens of milliseconds,
// without going through the database. It's either the Cloudflare relay in /relay (set
// NEXT_PUBLIC_RELAY_URL, e.g. on Vercel) or server.mjs's own /ws (self-hosted). If neither can be
// reached, `connected` stays false and the board uses Neon for all of it.

/** e.g. "wss://drawory-relay.you.workers.dev". Unset: the same server the page came from. */
const RELAY_URL = (process.env.NEXT_PUBLIC_RELAY_URL ?? "").replace(/\/+$/, "");

function relayAddress(boardId: string, userId: string) {
  const query = `room=${encodeURIComponent(boardId)}&user=${encodeURIComponent(userId)}`;
  if (RELAY_URL) return `${RELAY_URL.replace(/^http/, "ws")}/ws?${query}`;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws?${query}`;
}

export type SocketSignal = { kind: "wave" | "yt"; from: string; payload: Record<string, unknown> };
type Incoming =
  | { t: "hello"; now: number; peers: (Partial<PresenceRow> & { user_id: string; at: number })[] }
  | { t: "p"; p: Partial<PresenceRow> & { user_id: string }; at: number }
  | { t: "bye"; user: string }
  | { t: "s"; kind: "wave" | "yt"; from: string; payload: Record<string, unknown> }
  | { t: "pong"; now: number };

const RETRY_MS = [500, 1_000, 2_000, 5_000, 10_000, 15_000];
/** After this many failed attempts in a row, slow down: the host likely has no relay at all. */
const GIVE_UP_AFTER = 6;

function toRow(p: Partial<PresenceRow> & { user_id: string }, at: number): PresenceRow {
  return {
    user_id: p.user_id,
    name: typeof p.name === "string" ? p.name : "Someone",
    color: typeof p.color === "string" ? p.color : "#2F6BD0",
    cursor_x: typeof p.cursor_x === "number" ? p.cursor_x : null,
    cursor_y: typeof p.cursor_y === "number" ? p.cursor_y : null,
    view_x: Number(p.view_x) || 0,
    view_y: Number(p.view_y) || 0,
    view_w: Number(p.view_w) || 0,
    view_h: Number(p.view_h) || 0,
    zoom: Number(p.zoom) || 1,
    tool: typeof p.tool === "string" ? p.tool : null,
    watching: typeof p.watching === "string" ? p.watching : null,
    page: typeof p.page === "string" ? p.page : null,
    activity: p.activity && typeof p.activity === "object" ? p.activity : null,
    listening: p.listening && typeof p.listening === "object" ? p.listening : null,
    say: typeof p.say === "string" ? p.say.slice(0, 140) : null,
    updated_at: new Date(at),
  };
}

export function useRoomSocket(boardId: string, userId: string, onClock: (serverNow: number, rtt: number) => void, enabled = true) {
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState<Map<string, PresenceRow>>(() => new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const signalListeners = useRef(new Set<(s: SocketSignal) => void>());
  const onClockRef = useRef(onClock);
  useEffect(() => {
    onClockRef.current = onClock;
  }, [onClock]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    // Peer updates can arrive 30+ times a second each; apply them at most once per frame.
    const pending = new Map<string, PresenceRow | null>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      flushTimer = undefined;
      if (!pending.size) return;
      const changes = [...pending];
      pending.clear();
      setPeers((prev) => {
        const next = new Map(prev);
        for (const [id, row] of changes) {
          if (row) next.set(id, row);
          else next.delete(id);
        }
        return next;
      });
    };
    const queue = (id: string, row: PresenceRow | null) => {
      pending.set(id, row);
      flushTimer ??= setTimeout(flush, 16);
    };

    const connect = () => {
      if (stopped) return;
      const ws = new WebSocket(relayAddress(boardId, userId));
      wsRef.current = ws;
      let pingSentAt = 0;

      ws.onopen = () => {
        attempts = 0;
        setConnected(true);
        pingTimer = setInterval(() => {
          pingSentAt = Date.now();
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "ping" }));
        }, 20_000);
      };
      ws.onmessage = (e) => {
        let msg: Incoming;
        try {
          msg = JSON.parse(e.data as string);
        } catch {
          return;
        }
        switch (msg.t) {
          case "hello":
            onClockRef.current(msg.now, 0);
            setPeers(new Map(msg.peers.filter((p) => p.user_id !== userId).map((p) => [p.user_id, toRow(p, p.at)])));
            break;
          case "p":
            if (msg.p.user_id !== userId) queue(msg.p.user_id, toRow(msg.p, msg.at));
            break;
          case "bye":
            queue(msg.user, null);
            break;
          case "s":
            if (msg.from !== userId) for (const l of signalListeners.current) l({ kind: msg.kind, from: msg.from, payload: msg.payload });
            break;
          case "pong":
            if (pingSentAt) onClockRef.current(msg.now, Date.now() - pingSentAt);
            break;
        }
      };
      ws.onclose = () => {
        clearInterval(pingTimer);
        if (wsRef.current === ws) wsRef.current = null;
        setConnected(false);
        setPeers(new Map());
        if (stopped) return;
        attempts += 1;
        const wait = attempts > GIVE_UP_AFTER ? 60_000 : RETRY_MS[Math.min(attempts - 1, RETRY_MS.length - 1)];
        retryTimer = setTimeout(connect, wait);
      };
    };

    // Coming back to the tab or the network: reconnect right away instead of waiting out a backoff.
    const kick = () => {
      if (stopped || document.hidden || wsRef.current) return;
      clearTimeout(retryTimer);
      attempts = 0;
      connect();
    };
    document.addEventListener("visibilitychange", kick);
    window.addEventListener("online", kick);

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearTimeout(flushTimer);
      clearInterval(pingTimer);
      document.removeEventListener("visibilitychange", kick);
      window.removeEventListener("online", kick);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [boardId, userId, enabled]);

  /** Sends if connected; returns false otherwise so the caller can fall back. */
  const send = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  const onSignal = useCallback((listener: (s: SocketSignal) => void) => {
    signalListeners.current.add(listener);
    return () => {
      signalListeners.current.delete(listener);
    };
  }, []);

  return { connected, peers, send, onSignal };
}
