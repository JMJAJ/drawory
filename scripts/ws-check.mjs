// Checks the live relay on a running server: node --env-file=.env.local scripts/ws-check.mjs ws://localhost:3000
// With the Cloudflare relay, pass it second: ... ws://localhost:3000 wss://drawory-relay.<you>.workers.dev
// Creates a throwaway room, measures relay latency, and deletes the room.
import { WebSocket } from "ws";
const base = process.argv[2];
const relay = process.argv[3] ?? base;
const make = (name) => fetch(base.replace("ws", "http") + "/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).then((r) => r.json());
const room = (await make("ws test")).id;
const open = (user) => new Promise((res, rej) => { const ws = new WebSocket(`${relay}/ws?room=${room}&user=${user}`, { headers: { Origin: "http://localhost:3000" } }); ws.on("open", () => res(ws)); ws.on("error", rej); ws.on("unexpected-response", (_q, r) => rej(new Error("status " + r.statusCode))); });
const first = await open("x").catch((e) => e);
const missing = await new Promise((res) => { const ws = new WebSocket(`${relay}/ws?room=nosuchroom&user=a`, { headers: { Origin: "http://localhost:3000" } }); ws.on("unexpected-response", (_q, r) => res(r.statusCode)); ws.on("open", () => res("opened?!")); });
const a = await open("alice");
const b = await open("bob");
const times = [];
b.on("message", (d) => { const m = JSON.parse(d); if (m.t === "p") times.push(Date.now() - m.p.sentAt); });
for (let i = 0; i < 50; i++) { a.send(JSON.stringify({ t: "p", p: { name: "Alice", color: "#f00", cursor_x: i, cursor_y: i, sentAt: Date.now() } })); await new Promise((r) => setTimeout(r, 16)); }
await new Promise((r) => setTimeout(r, 300));
// A late joiner gets everyone's current state right away.
const c = await open("carol");
const hello = await new Promise((res) => c.once("message", (d) => res(JSON.parse(d))));
let bye = false; b.on("message", (d) => { if (JSON.parse(d).t === "bye") bye = true; });
a.close(); await new Promise((r) => setTimeout(r, 300));
times.sort((x, y) => x - y);
console.log({ room, firstSocketOk: !(first instanceof Error), unknownRoomStatus: missing, received: times.length, medianMs: times[25], p95Ms: times[47], helloPeers: hello.peers.map((p) => p.user_id), byeOnLeave: bye });
[first, b, c].forEach((w) => w?.close?.());
const pg = (await import("pg")).default; const db = new pg.Client({ connectionString: process.env.DATABASE_URL.replace("sslmode=require", "sslmode=verify-full") }); await db.connect(); await db.query("delete from boards where id = $1", [room]); await db.end();
process.exit(0);
