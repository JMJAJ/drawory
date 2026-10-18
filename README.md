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

Any Node host that runs `npm run build` and `npm run start` works (Render, Railway, Fly.io, a VPS). Prefer one that runs a long-lived server: Vercel's serverless functions cap request bodies at 4.5 MB, which would limit video and voice uploads.

1. Set the environment variables above on the host. `NEXT_PUBLIC_NEON_REALTIME_URL` must be there at build time.
2. Run `npm run db:migrate` once against the database (safe to re-run).
3. Let Realtime accept your site: `APP_ORIGINS=https://your-site.example neon deploy`. Until then everything still works, just by polling instead of instantly.
4. Open the site, create a room, and send people its code or invite link.
