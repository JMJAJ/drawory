# drawory

An endless canvas you share. Built for two, and anyone else you invite can draw and edit at the same time, each with their own cursor color. Draw, write, stick stickers, drop photos and videos, watch YouTube together, leave voice notes, seal time capsules, and replay everything in Memory Lane. Day and night themes.

Built with Next.js 16 and Neon (Postgres + Realtime live queries).

## Run it

```bash
npm install
npm run db:migrate   # creates the tables (safe to re-run)
npm run build
npm run start        # http://localhost:3000
```

Sign in with `APP_PASSCODE` from `.env.local`, then pick your name and color. Share the URL and passcode with your person.

`npm run test:smoke` checks a running server end to end (auth, live queries, writes, presence, hearts, uploads, capsules, history) on a throwaway board.

## Environment (`.env.local`)

| Variable | From |
| --- | --- |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_REALTIME_URL`, `NEON_REALTIME_SECRET` | `neon deploy` / `neon env pull` |
| `APP_PASSCODE` | The shared passcode. Changing it signs everyone out. |
| `AUTH_SECRET` | Random string that signs the login cookie. |

## How sync works

- The board, cursors and signals (hearts, synced video) are three **Neon Realtime live queries**, sealed per board by `POST /api/boards/:id/live` and renewed before they expire.
- Writes go through route handlers. Each element change is one SQL statement that also appends to `element_events` (Memory Lane) and returns its `txid`, so the UI can drop its optimistic copy once the change streams back.
- Time capsule messages live in `capsule_items`, which no live query reads; the server refuses to open them before the unlock date.
- Uploads (25 MB max) are stored in Postgres and served with Range support.

## Deploying

1. Add your production origin to `allowedOrigins` in `neon.ts` and run `neon deploy`.
2. Set the env vars above on your host.
3. Stickers load from Discord's CDN by URL (`src/lib/stickers.ts`).
