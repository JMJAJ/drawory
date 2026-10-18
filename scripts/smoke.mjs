// End-to-end check against a running app: npm run start, then npm run test:smoke
// Creates a throwaway room and deletes it afterwards.
import { createRealtimeClient } from "@neon/realtime/client";
import pg from "pg";

const BASE = process.env.SMOKE_URL ?? "http://localhost:3000";
let BOARD = "";
let cookie = "";
let failures = 0;

function check(label, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!ok) failures++;
}

async function call(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) },
  });
  return res;
}
const json = (body, method = "POST") => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const waitFor = async (fn, ms = 10_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

// 1. Auth: only when a site-wide passcode is set; otherwise rooms are open to anyone with a code.
if (process.env.APP_PASSCODE) {
  const anon = await call(`/api/rooms`, json({ name: "x" }));
  check("API refuses requests without the passcode cookie", anon.status === 401, `status ${anon.status}`);
  const bad = await call("/api/login", json({ passcode: "wrong" }));
  check("Wrong passcode is rejected", bad.status === 401);
  const good = await call("/api/login", json({ passcode: process.env.APP_PASSCODE }));
  cookie = (good.headers.get("set-cookie") ?? "").split(";")[0];
  check("Correct passcode signs in", good.ok && cookie.startsWith("drawory_session="));
} else {
  const home = await call("/", { redirect: "manual" });
  check("Home screen is open without a passcode", home.status === 200, `status ${home.status}`);
}

// 1b. Rooms
const missing = await call(`/api/boards/nosuchroom/live`, json({ query: "elements" }));
check("Unknown room code is a 404, not a new room", missing.status === 404, `status ${missing.status}`);
const created = await call("/api/rooms", json({ name: "Smoke room", by: "smoke" }));
const room = await created.json();
BOARD = room.id;
check("Creates a room with a 6-character code", created.status === 201 && /^[a-z2-9]{6}$/.test(room.id), room.id);
const meta = await (await call(`/api/boards/${BOARD}`)).json();
check("Room keeps its name", meta.name === "Smoke room");

// 2. Seal live queries
const sealed = {};
for (const q of ["elements", "presence", "signals", "chat"]) {
  const res = await call(`/api/boards/${BOARD}/live`, json({ query: q }));
  sealed[q] = await res.json();
  check(`Seals the ${q} live query`, res.ok && typeof sealed[q].capability === "string" && sealed[q].expiresAt > Date.now());
}

// 3. Subscribe through Neon Realtime
const client = createRealtimeClient({ url: process.env.NEON_REALTIME_URL, logLevel: "warn" });
const elSub = client.subscribe(sealed.elements);
const prSub = client.subscribe(sealed.presence);
const sgSub = client.subscribe(sealed.signals);
const chSub = client.subscribe(sealed.chat);
const live = await waitFor(() => elSub.getSnapshot().status === "live" && prSub.getSnapshot().status === "live");
check("Realtime subscriptions go live", live, `elements=${elSub.getSnapshot().status} presence=${prSub.getSnapshot().status}`);

// 4. Write an element and watch it arrive
const id = crypto.randomUUID();
const t0 = Date.now();
const write = await call(
  `/api/boards/${BOARD}/elements`,
  json({ author: "smoke", ops: [{ op: "upsert", id, type: "note", z: 1, data: { x: 10, y: 20, w: 260, title: "Smoke list", items: [{ id: "a", text: "it works", done: false }] } }] }),
);
const { txid } = await write.json();
check("Element write returns a txid", write.ok && typeof txid === "string", `txid ${txid}`);
await elSub.awaitTxId(txid, 10_000).catch(() => {});
const arrived = await waitFor(() => (elSub.getSnapshot().data ?? []).some((r) => r.id === id && r.data.title === "Smoke list"));
check("New element streams to subscribers", arrived, `${Date.now() - t0} ms`);

// Update
const upd = await call(
  `/api/boards/${BOARD}/elements`,
  json({ author: "smoke", ops: [{ op: "upsert", id, type: "note", z: 1, data: { x: 50, y: 20, w: 260, title: "Smoke list", items: [{ id: "a", text: "it works", done: true }] } }] }),
);
await elSub.awaitTxId((await upd.json()).txid, 10_000).catch(() => {});
check("Element update streams", await waitFor(() => (elSub.getSnapshot().data ?? []).some((r) => r.id === id && r.data.x === 50 && r.data.items[0].done)));

// 5. Presence and signals
const pres = await call(`/api/boards/${BOARD}/presence`, json({ user_id: "smoke-user", name: "Smoke", color: "#2F6BD0", cursor_x: 12.5, cursor_y: 40, view_x: 0, view_y: 0, view_w: 1440, view_h: 900, zoom: 1, tool: "pen", activity: { k: "draw", pts: [[0, 0], [10, 5], [20, 12]], c: "rose", s: 6 } }));
const serverNow = (await pres.json()).now;
check("Presence answers with the server clock", Math.abs(serverNow - Date.now()) < 60_000, `${serverNow - Date.now()} ms off`);
check("Presence (cursor) streams", await waitFor(() => (prSub.getSnapshot().data ?? []).some((p) => p.user_id === "smoke-user" && p.cursor_x === 12.5 && p.tool === "pen")));
check("Live activity (stroke in progress) streams", await waitFor(() => (prSub.getSnapshot().data ?? []).some((p) => p.user_id === "smoke-user" && p.activity?.k === "draw" && p.activity.pts.length === 3)));
const sig = await call(`/api/boards/${BOARD}/signals`, json({ kind: "wave", from: "smoke-user" }));
check("Wave signal accepted", sig.status === 204);
check("Wave signal streams", await waitFor(() => (sgSub.getSnapshot().data ?? []).some((s) => s.kind === "wave" && s.from_user === "smoke-user")));

// 5b. Polling fallback (used when the live connection can't be reached)
const snap = await (await call(`/api/boards/${BOARD}/snapshot?q=elements`)).json();
check("Snapshot returns the board", Array.isArray(snap.rows) && snap.rows.some((r) => r.id === id) && typeof snap.v === "string");
const same = await (await call(`/api/boards/${BOARD}/snapshot?q=elements&v=${encodeURIComponent(snap.v)}`)).json();
check("Snapshot skips an unchanged board", same.unchanged === true);
const prSnap = await (await call(`/api/boards/${BOARD}/snapshot?q=presence`)).json();
check("Snapshot returns cursors", prSnap.rows?.some((p) => p.user_id === "smoke-user" && p.cursor_x === 12.5));
const strange = await call("/api/stickers/123.png");
check("Sticker route only serves built-in stickers", strange.status === 404);

// 6. Media upload and Range reads
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const form = new FormData();
form.append("file", new Blob([png], { type: "image/png" }), "dot.png");
const up = await call(`/api/boards/${BOARD}/media`, { method: "POST", body: form });
const media = await up.json();
check("Uploads a photo", up.ok && media.url?.startsWith("/api/media/"));
const got = Buffer.from(await (await call(media.url)).arrayBuffer());
check("Serves the photo back byte-for-byte", got.equals(png), `${got.length} bytes`);
const part = await call(media.url, { headers: { Range: "bytes=0-7" } });
check("Supports Range requests for seeking", part.status === 206 && (await part.arrayBuffer()).byteLength === 8);

// 7. Time capsule stays sealed
const capId = crypto.randomUUID();
const cap = await call(
  `/api/boards/${BOARD}/capsules`,
  json({ id: capId, title: "Smoke capsule", body: "secret", unlockAt: new Date(Date.now() + 3_600_000).toISOString(), x: 0, y: 0, z: 2, author: "smoke", authorName: "Smoke" }),
);
check("Seals a capsule", cap.ok);
check("Capsule envelope streams without its message", await waitFor(() => (elSub.getSnapshot().data ?? []).some((r) => r.id === capId && !JSON.stringify(r.data).includes("secret"))));
const peek = await call(`/api/boards/${BOARD}/capsules/${capId}`);
check("Capsule refuses to open before its date", peek.status === 403);

// 8. History and delete
const hist = await (await call(`/api/boards/${BOARD}/history`)).json();
check("Memory Lane history records every change", Array.isArray(hist) && hist.filter((e) => e.element_id === id).length === 2, `${hist.length} events`);
const del = await call(`/api/boards/${BOARD}/elements`, json({ author: "smoke", ops: [{ op: "delete", id }] }));
await elSub.awaitTxId((await del.json()).txid, 10_000).catch(() => {});
check("Delete streams to subscribers", await waitFor(() => !(elSub.getSnapshot().data ?? []).some((r) => r.id === id)));

// 9. Sealed queries renew
const renewed = await (await call(`/api/boards/${BOARD}/live`, json({ query: "elements" }))).json();
await elSub.renew(renewed).then(() => check("Sealed query renews", true), (e) => check("Sealed query renews", false, e.message));

// 10. Chat
const msg = await call(`/api/boards/${BOARD}/messages`, json({ user_id: "smoke-user", name: "Smoke", color: "#2F6BD0", body: "hello room" }));
check("Chat message saved", msg.status === 201);
check("Chat message streams", await waitFor(() => (chSub.getSnapshot().data ?? []).some((m) => m.body === "hello room" && m.name === "Smoke")));

// 11. Pages
const pagesRes = await call(`/api/boards/${BOARD}`, json({ pages: [{ id: "main", name: "Doodles" }, { id: "p-plans", name: "Plans" }], from: "smoke" }, "PATCH"));
const pagesBody = await pagesRes.json();
check("Saves a room's pages", pagesRes.ok && pagesBody.pages?.length === 2 && pagesBody.pages[1].name === "Plans");
const badPages = await call(`/api/boards/${BOARD}`, json({ pages: [], from: "smoke" }, "PATCH"));
check("Refuses a room with no pages", badPages.status === 400);

// 12. Cloudinary uploads (only when configured)
const sigRes = await call(`/api/boards/${BOARD}/upload-signature`, { method: "POST" });
if (sigRes.status === 404) {
  console.log("SKIP  Cloudinary not configured (uploads go to Postgres)");
} else {
  const sig = await sigRes.json();
  check("Signs a Cloudinary upload for the room's folder", sigRes.ok && sig.folder === `drawory/${BOARD}` && /^[0-9a-f]{40}$/.test(sig.signature));
  const up = new FormData();
  up.append("file", new Blob([png], { type: "image/png" }), "dot.png");
  for (const k of ["api_key", "timestamp", "folder", "signature"]) up.append(k, String(sig[k === "api_key" ? "apiKey" : k]));
  const cl = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/auto/upload`, { method: "POST", body: up });
  const clBody = await cl.json();
  check("Uploads straight to Cloudinary", cl.ok && typeof clBody.secure_url === "string", clBody.error?.message ?? clBody.public_id);
  if (cl.ok) {
    const served = await fetch(clBody.secure_url.replace("/upload/", "/upload/f_auto,q_auto/"));
    check("Cloudinary serves it back", served.ok, `${served.status} ${served.headers.get("content-type")}`);
  }
}

client.close();

// Clean up the throwaway board.
const db = new pg.Client({ connectionString: process.env.DATABASE_URL.replace("sslmode=require", "sslmode=verify-full") });
await db.connect();
await db.query("delete from boards where id = $1", [BOARD]);
await db.end();

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
