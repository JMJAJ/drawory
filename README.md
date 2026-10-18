# drawory

An endless canvas you draw on together. Make a room, share its code, and everyone in it draws and edits at the same time, each in their own cursor color, seeing each other's strokes, selection boxes, drags and typing as they happen. Write in five fonts, stick stickers, drop photos and videos, watch YouTube together, leave voice notes, seal time capsules, and replay a room's whole history. Day and night themes.

Built with Next.js 16 and Neon (Postgres + Realtime live queries).

## Run it

```bash
npm install
npm run db:migrate   # creates the tables (safe to re-run)
npm run build
npm run start        # http://localhost:3000
```

The home screen lets you **create a room** (you get a 6-character code like `K7M2QX`) or **join one** with a code or invite link. Rooms you've opened are listed there too. Pick your name and cursor color the first time; the code chip at the top of a room copies its invite link.

Anyone with a room's code can join it. To lock the whole site behind one passcode as well, set `APP_PASSCODE`.

`npm run test:smoke` checks a running server end to end (rooms, live queries, writes, presence and live activity, waves, uploads, capsules, history) in a throwaway room. Point it elsewhere with `SMOKE_URL=http://localhost:3001`.

## Environment (`.env.local`)

| Variable | From |
| --- | --- |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | `neon deploy` / `neon env pull` (any Postgres works) |
| `NEON_REALTIME_SECRET`, `NEXT_PUBLIC_NEON_REALTIME_URL` | `neon deploy` / `neon env pull`. Optional: without them the board syncs by polling. |
| `APP_PASSCODE` | Optional site-wide passcode on top of room codes. Unset: anyone with a room code can join. |
| `AUTH_SECRET` | Random string that signs the login cookie. |
| `APP_ORIGINS` | Only read by `neon deploy`: your site's address(es), comma separated. See Deploying. |

## How sync works

Two channels, each doing what it's best at:

| What | How | Speed |
| --- | --- | --- |
| Board content (strokes, notes, photos, history) | Saved in Postgres, streamed by Neon Realtime | ~150 ms, durable |
| Cursors, live activity, waves, video sync | WebSocket relay in `server.mjs`, room by room, never stored | ~20–30 ms, ~40 updates/s |

- `npm run start` runs `server.mjs`: the Next.js app plus the relay on `/ws`, one process and one port, so it's free wherever Node runs. The relay checks the room exists (and the site passcode, if set), then passes each update to everyone else in the room. Newcomers get everyone's current state at once.
- If the relay can't be reached (a host without WebSockets, like Vercel), the board quietly does the same through the database instead, just slower. Presence is also written to the database every few seconds while on the relay, so people without it still see you, and "was here 2 h ago" works.
- `node --env-file=.env.local scripts/ws-check.mjs ws://localhost:3000` checks the relay on a running server.
- A room's id is its code (`POST /api/rooms` makes one). Codes nobody created are a 404, never a new room.
- The board, cursors and signals (waves, synced video) are three **Neon Realtime live queries**, sealed per board by `POST /api/boards/:id/live` and renewed before they expire.
- If the live connection can't be reached (Realtime not set up, the site's address not in its allowed origins yet, a network that blocks WebSockets, a phone that just woke up), the board switches to polling `GET /api/boards/:id/snapshot` after 5 seconds: about once a second for the board, a bit faster for cursors. It keeps trying to go live again, and switches back the moment it can. The status pill (bottom right) says **Live**, **Synced** (polling), **Connecting…** or **Offline**; tap it to retry.
- Writes go through route handlers. Each element change is one SQL statement that also appends to `element_events` (Memory Lane) and returns its `txid`, so the UI can drop its optimistic copy once the change streams back. Saves retry through short network drops.
- Presence also carries what each person is doing right now (`activity`: a stroke in progress, a selection box, a drag or resize, text being typed, what they have selected). Everyone else draws it live in that person's color, and it clears shortly after they finish, once the saved result has arrived. Updates go out about 20 times a second while you're active, one at a time, and remote cursors glide between updates instead of jumping.
- Presence answers with the server's clock, so a device whose clock is off still shows everyone else as online.
- Anyone whose cursor is off your screen gets a marker on the screen edge pointing at them; tap it to go there. Following someone (their avatar, top right) fits their whole view on your screen, phone or laptop.
- Time capsule messages live in `capsule_items`, which no live query reads; the server refuses to open them before the unlock date.
- Uploads (25 MB max) are stored in Postgres and served with Range support. Big photos are resized in the browser first (longest side 2560 px), so a 12 MB phone photo is stored at 1–3 MB. Uploads that never made it onto the board are deleted after a day; anything that was ever on the board is kept for Memory Lane.
- Stickers are copied from Discord into the `sticker_cache` table the first time anyone sees each one, then always served from there.

## On phones and tablets

- Opens on the Select tool: one finger moves around the board, two fingers pinch to zoom, tap to select, tap twice to edit text or a list. Press and hold on empty space, then drag, to select several things. Pick Draw to draw with your finger or pen.
- The tool bar scrolls sideways. Add drawory to your home screen (Share → Add to Home Screen) to open it full screen like an app.
- Voice notes need the site on `https://` (browsers only allow the microphone on secure sites, or on localhost).

On your home Wi-Fi you can use it from your phone without hosting it anywhere: run `npm run start` on your computer, then open `http://<your computer's local IP>:3000` on the phone (Next prints this as "Network"). It syncs by polling unless you add that address to `APP_ORIGINS` (below).

## Deploying

### Free and always on (recommended): Vercel + Cloudflare relay + Neon

| Piece | Where | Cost |
| --- | --- | --- |
| The site | Vercel (`drawory.vercel.app`) | Free |
| Live relay (cursors, live activity) | Cloudflare Worker in `relay/` (`drawory-relay.drawory-relay.workers.dev`) | Free plan, Durable Objects |
| Data and Realtime | Neon | Free plan |

1. **Relay**: `cd relay && npm install && npx wrangler login && npx wrangler deploy`. Allowed sites and the site address are in `relay/wrangler.toml`.
2. **Vercel environment variables** (Project → Settings → Environment Variables), then redeploy:
   - `DATABASE_URL`, `NEON_REALTIME_SECRET`, `AUTH_SECRET`: same values as `.env.local`.
   - `NEXT_PUBLIC_NEON_REALTIME_URL`: the actual URL (copy `NEON_REALTIME_URL`'s value; Vercel doesn't expand `$NAME`).
   - `NEXT_PUBLIC_RELAY_URL` = `wss://drawory-relay.drawory-relay.workers.dev`
   - Remove `APP_PASSCODE` so room codes are enough to join.
3. **Neon Realtime** already allows `https://drawory.vercel.app` (it's in `neon.ts`).

Free-plan headroom: Cloudflare counts about 20 relay messages as one request, 100,000 requests a day, so roughly 2 million live updates a day (many hours of several people drawing). If it's ever exceeded, the board falls back to the database path until the daily reset. Vercel's 4.5 MB request limit caps video and voice uploads there.

### Self-hosted

Any Node host that runs `npm run build` and `npm run start` works, as long as it keeps a server running; `server.mjs` then serves the relay itself on `/ws` (leave `NEXT_PUBLIC_RELAY_URL` unset).

**Free options**
- **Your own computer**: `npm run build && npm run start`. On the same Wi-Fi, others open `http://<your computer's IP>:3000`. From anywhere, put a free tunnel in front, e.g. `cloudflared tunnel --url http://localhost:3000` (WebSockets work through it).
- **Render free web service**: connect the GitHub repo, build command `npm install && npm run build`, start command `npm run start`, add the environment variables. WebSockets work. Free instances sleep after 15 minutes without visitors and take ~1 minute to wake on the next visit.
- The database stays on Neon's free plan either way.

1. Set the environment variables above on the host. `NEXT_PUBLIC_NEON_REALTIME_URL` must be there at build time.
2. Run `npm run db:migrate` once against the database (safe to re-run).
3. Let Realtime accept your site: `APP_ORIGINS=https://your-site.example neon deploy`. Until then everything still works, just by polling instead of instantly.
4. Open the site, create a room, and send people its code or invite link.
