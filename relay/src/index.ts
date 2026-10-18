// drawory's live relay on Cloudflare (free, always on). One Durable Object per room passes cursors,
// strokes in progress, selection boxes, typing, waves and video sync between everyone in that room.
// Nothing is stored. Same protocol as server.mjs, so the app works with either.
//
// Hibernation keeps idle rooms free: the object sleeps between messages and wakes when one arrives.

import { DurableObject } from "cloudflare:workers";

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  /** Comma-separated sites allowed to connect, e.g. "https://drawory.vercel.app,http://localhost:3000". */
  ALLOWED_ORIGINS: string;
  /** The drawory site. Each room asks it once whether the room exists, so made-up codes get nowhere. */
  APP_URL?: string;
}

const ROOM_ID = /^[a-z0-9-]{1,40}$/;
const USER_ID = /^[\w-]{1,64}$/;
const MAX_MESSAGE = 32 * 1024;
const MAX_PER_SECOND = 60;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/") return new Response("drawory relay is running", { headers: { "content-type": "text/plain" } });
    if (url.pathname !== "/ws") return new Response("Not found", { status: 404 });
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket", { status: 426 });

    // Only the drawory site(s) may connect from a browser.
    const origin = req.headers.get("Origin");
    const allowed = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);
    if (origin && !allowed.includes(origin)) return new Response("Origin not allowed", { status: 403 });

    const room = url.searchParams.get("room") ?? "";
    const user = url.searchParams.get("user") ?? "";
    if (!ROOM_ID.test(room) || !USER_ID.test(user)) return new Response("Bad request", { status: 400 });
    return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(req);
  },
} satisfies ExportedHandler<Env>;

interface Peer {
  user: string;
  state: Record<string, unknown> | null;
  at: number;
  budget: number;
  budgetAt: number;
}

export class Room extends DurableObject<Env> {
  /** Live state per socket. Rebuilt after a wake-up from everyone's next update. */
  private peers = new Map<WebSocket, Peer>();
  /** Whether the site says this room exists; checked once per wake-up. */
  private exists: boolean | undefined;

  private async roomExists(room: string) {
    if (this.exists !== undefined || !this.env.APP_URL) return this.exists ?? true;
    try {
      const res = await fetch(`${this.env.APP_URL.replace(/\/+$/, "")}/api/boards/${room}`);
      // Only a clear "no such room" blocks; if the site is unsure (passcode, outage), let people in.
      this.exists = res.status !== 404;
    } catch {
      return true;
    }
    return this.exists;
  }

  private peer(ws: WebSocket): Peer {
    let p = this.peers.get(ws);
    if (!p) {
      const { user } = (ws.deserializeAttachment() ?? {}) as { user?: string };
      p = { user: user ?? "unknown", state: null, at: 0, budget: MAX_PER_SECOND, budgetAt: Date.now() };
      this.peers.set(ws, p);
    }
    return p;
  }

  private broadcast(from: WebSocket | null, msg: unknown) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === from) continue;
      try {
        ws.send(text);
      } catch {
        // Closing socket; its close handler tidies up.
      }
    }
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (!(await this.roomExists(url.searchParams.get("room") ?? ""))) return new Response("No such room", { status: 404 });
    const user = url.searchParams.get("user") ?? "";
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ user });
    this.peer(server);

    // Everyone already here, so a newcomer sees their cursors at once.
    const others = this.ctx
      .getWebSockets()
      .filter((ws) => ws !== server)
      .map((ws) => this.peer(ws))
      .filter((p) => p.state)
      .map((p) => ({ ...p.state, at: p.at }));
    server.send(JSON.stringify({ t: "hello", now: Date.now(), peers: others }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== "string" || data.length > MAX_MESSAGE) return;
    const p = this.peer(ws);
    // Simple rate limit: drop anything beyond MAX_PER_SECOND messages a second.
    const now = Date.now();
    p.budget = Math.min(MAX_PER_SECOND, p.budget + ((now - p.budgetAt) / 1000) * MAX_PER_SECOND);
    p.budgetAt = now;
    if (p.budget < 1) return;
    p.budget -= 1;

    let msg: { t?: string; p?: Record<string, unknown>; kind?: string; payload?: unknown };
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    switch (msg?.t) {
      case "p":
        if (!msg.p || typeof msg.p !== "object") return;
        p.state = { ...msg.p, user_id: p.user };
        p.at = now;
        this.broadcast(ws, { t: "p", p: p.state, at: now });
        break;
      case "s":
        if (msg.kind !== "wave" && msg.kind !== "yt") return;
        this.broadcast(ws, { t: "s", kind: msg.kind, from: p.user, payload: msg.payload ?? {}, at: now });
        break;
      case "ping":
        ws.send(JSON.stringify({ t: "pong", now }));
        break;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    this.leave(ws);
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  async webSocketError(ws: WebSocket) {
    this.leave(ws);
  }

  private leave(ws: WebSocket) {
    const user = this.peer(ws).user;
    this.peers.delete(ws);
    // Only say goodbye if this person has no other tab still open in the room.
    const stillHere = this.ctx.getWebSockets().some((other) => other !== ws && this.peer(other).user === user);
    if (!stillHere) this.broadcast(ws, { t: "bye", user });
  }
}
