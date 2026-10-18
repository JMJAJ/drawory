// drawory's server: the Next.js app plus a WebSocket relay for live, throwaway updates
// (cursors, strokes in progress, selection boxes, typing, waves, video sync).
//
// Saved board content still goes through Postgres + Neon Realtime. These live updates never touch
// the database: each one is passed straight to the other people in the same room, so they arrive in
// tens of milliseconds. One process, one port, no extra service, so it runs free anywhere Node runs.
//
//   node server.mjs         production (after `next build`)
//   node server.mjs --dev   development, with hot reload

import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import next from "next";
import pg from "pg";
import { WebSocketServer } from "ws";

const dev = process.argv.includes("--dev");
process.env.NODE_ENV ??= dev ? "development" : "production";
const port = Number(process.env.PORT) || 3000;
const hostname = process.env.HOSTNAME || "0.0.0.0";

const httpServer = createServer();
const app = next({ dev, port, httpServer });
const handle = app.getRequestHandler();
// We route WebSocket upgrades ourselves (below), so stop Next from attaching its own listener
// and forward everything that isn't ours to it (that's how hot reload keeps working in dev).
app.didWebSocketSetup = true;

await app.prepare(); // also loads .env / .env.local into process.env
const nextUpgrade = app.getUpgradeHandler();

/* ---------- Access checks ---------- */

const ROOM_ID = /^[a-z0-9-]{1,40}$/;
const USER_ID = /^[\w-]{1,64}$/;

const pool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL.replace("sslmode=require", "sslmode=verify-full"), max: 3 })
  : null;
pool?.on("error", (e) => console.error("ws pg pool", e));

/** Rooms that exist, remembered for a minute so reconnects don't hit the database. */
const knownRooms = new Map();
async function roomExists(id) {
  const hit = knownRooms.get(id);
  if (hit && Date.now() - hit < 60_000) return true;
  if (!pool) return true; // no database configured: nothing to check against
  const { rowCount } = await pool.query("select 1 from boards where id = $1", [id]);
  if (rowCount) knownRooms.set(id, Date.now());
  return rowCount > 0;
}

/** Same rule as src/lib/auth.ts: only enforced when a site-wide APP_PASSCODE is set. */
function hasSession(req) {
  const passcode = process.env.APP_PASSCODE;
  if (!passcode) return true;
  const secret = process.env.AUTH_SECRET || process.env.NEON_REALTIME_SECRET || "drawory-dev";
  const expected = createHmac("sha256", secret).update(`drawory:${passcode}`).digest("hex");
  const cookie = (req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith("drawory_session="));
  const got = cookie?.slice("drawory_session=".length) ?? "";
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/* ---------- Rooms ---------- */

/** roomId -> Set of sockets. Each socket carries { room, user, state }. */
const rooms = new Map();
const MAX_MESSAGE = 32 * 1024;
const MAX_PER_SECOND = 90;

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
}
function broadcast(from, msg) {
  const text = JSON.stringify(msg);
  for (const peer of rooms.get(from.meta.room) ?? []) if (peer !== from) send(peer, text);
}

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE, perMessageDeflate: false });

wss.on("connection", (ws, _req, meta) => {
  ws.meta = { ...meta, state: null, budget: MAX_PER_SECOND, budgetAt: Date.now() };
  ws.alive = true;
  if (!rooms.has(meta.room)) rooms.set(meta.room, new Set());
  const room = rooms.get(meta.room);
  room.add(ws);

  // Everyone already here, so a newcomer sees cursors at once.
  const peers = [...room].filter((p) => p !== ws && p.meta.state).map((p) => ({ ...p.meta.state, at: p.meta.at }));
  send(ws, { t: "hello", now: Date.now(), peers });

  ws.on("pong", () => (ws.alive = true));
  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    // Simple rate limit: drop anything beyond MAX_PER_SECOND messages a second.
    const m = ws.meta;
    const now = Date.now();
    m.budget = Math.min(MAX_PER_SECOND, m.budget + ((now - m.budgetAt) / 1000) * MAX_PER_SECOND);
    m.budgetAt = now;
    if (m.budget < 1) return;
    m.budget -= 1;

    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    switch (msg.t) {
      case "p": {
        // Presence: cursor, view, tool and what they're doing right now.
        if (!msg.p || typeof msg.p !== "object") return;
        m.state = { ...msg.p, user_id: m.user };
        m.at = now;
        broadcast(ws, { t: "p", p: m.state, at: now });
        break;
      }
      case "s": {
        // Signals: waves and synced video. `sid` lets clients drop the copy that also comes via Postgres.
        if (msg.kind !== "wave" && msg.kind !== "yt" && msg.kind !== "summon") return;
        broadcast(ws, { t: "s", kind: msg.kind, from: m.user, payload: msg.payload ?? {}, at: now });
        break;
      }
      case "ping":
        send(ws, { t: "pong", now });
        break;
    }
  });
  ws.on("close", () => {
    room.delete(ws);
    if (room.size === 0) rooms.delete(meta.room);
    // Only say goodbye if this person has no other tab still open in the room.
    if (![...room].some((p) => p.meta.user === meta.user)) {
      for (const peer of room) send(peer, { t: "bye", user: meta.user });
    }
  });
});

// Drop connections that stopped answering (a phone that lost signal), and keep idle ones open
// through proxies that close silent connections.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
}, 25_000);
wss.on("close", () => clearInterval(heartbeat));

httpServer.on("upgrade", async (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/ws") return nextUpgrade(req, socket, head);
  const room = url.searchParams.get("room") ?? "";
  const user = url.searchParams.get("user") ?? "";
  const refuse = (code, text) => {
    socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  if (!ROOM_ID.test(room) || !USER_ID.test(user)) return refuse(400, "Bad Request");
  if (!hasSession(req)) return refuse(401, "Unauthorized");
  try {
    if (!(await roomExists(room))) return refuse(404, "Not Found");
  } catch (e) {
    console.error("ws room check", e);
    return refuse(503, "Service Unavailable");
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req, { room, user }));
});

httpServer.on("request", (req, res) => handle(req, res));
httpServer.listen(port, hostname, () => {
  console.log(`> drawory ready on http://localhost:${port} (${dev ? "development" : "production"}, live relay on /ws)`);
});
