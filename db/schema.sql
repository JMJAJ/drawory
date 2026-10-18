-- Drawory schema. Safe to re-run: every statement is idempotent.

create table if not exists boards (
  id             text primary key,
  name           text not null default 'Our universe',
  together_since date,
  created_at     timestamptz not null default now()
);

-- Current state of every thing on a board. Streamed to clients by a live query.
create table if not exists elements (
  id         uuid primary key,
  board_id   text not null references boards(id) on delete cascade,
  type       text not null,
  data       jsonb not null,
  z          double precision not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists elements_board_idx on elements (board_id);

-- Append-only log of every change. Powers Memory Lane.
create table if not exists element_events (
  id         bigserial primary key,
  board_id   text not null references boards(id) on delete cascade,
  element_id uuid not null,
  op         text not null check (op in ('upsert', 'delete')),
  type       text,
  data       jsonb,
  z          double precision,
  author     text,
  created_at timestamptz not null default now()
);
create index if not exists element_events_board_idx on element_events (board_id, id);

-- Who is on the board right now: cursor, viewport and what they're doing.
create table if not exists presence (
  board_id   text not null references boards(id) on delete cascade,
  user_id    text not null,
  name       text not null,
  color      text not null,
  cursor_x   double precision,
  cursor_y   double precision,
  view_x     double precision not null default 0,
  view_y     double precision not null default 0,
  view_w     double precision not null default 0,
  view_h     double precision not null default 0,
  zoom       double precision not null default 1,
  tool       text,
  watching   uuid,
  updated_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

-- Short-lived nudges: waves, synced video play/pause, board setting changes.
create table if not exists signals (
  id         bigserial primary key,
  board_id   text not null references boards(id) on delete cascade,
  kind       text not null,
  from_user  text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists signals_board_idx on signals (board_id, id desc);

-- Uploaded photos, videos and voice notes.
create table if not exists media (
  id         uuid primary key,
  board_id   text not null references boards(id) on delete cascade,
  mime       text not null,
  name       text,
  size       integer not null,
  bytes      bytea not null,
  created_at timestamptz not null default now()
);

-- What's inside a time capsule. Never streamed; served only after it unlocks.
create table if not exists capsule_items (
  id          uuid primary key,
  board_id    text not null references boards(id) on delete cascade,
  element_id  uuid not null,
  author      text not null,
  author_name text,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists capsule_items_element_idx on capsule_items (element_id);

create table if not exists capsules (
  element_id uuid primary key,
  board_id   text not null references boards(id) on delete cascade,
  unlock_at  timestamptz not null
);

-- Built-in sticker images, copied from Discord the first time each is shown.
create table if not exists sticker_cache (
  file       text primary key,
  mime       text not null,
  bytes      bytea not null,
  created_at timestamptz not null default now()
);

-- Rooms: a board's id is its join code. Who made it, for "your rooms".
alter table boards add column if not exists created_by text;

-- What each person is doing right now (selection box, stroke in progress, dragging, typing),
-- so everyone else can watch it happen live. Cleared when they finish.
alter table presence add column if not exists activity jsonb;

-- Pages inside a room. Elements say which page they're on (data.page; none = "main").
alter table boards add column if not exists pages jsonb not null default '[{"id": "main", "name": "Page 1"}]'::jsonb;
-- Which page each person is looking at, so cursors only show on the same page.
alter table presence add column if not exists page text;

-- Room chat.
create table if not exists messages (
  id         bigserial primary key,
  board_id   text not null references boards(id) on delete cascade,
  user_id    text not null,
  name       text not null,
  color      text not null,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_board_idx on messages (board_id, id desc);

-- Chat boxes on the board: each is its own thread (the chat box element's id). No thread = the room chat.
alter table messages add column if not exists thread uuid;

-- Emoji reactions on chat messages: emoji -> user ids.
alter table messages add column if not exists reactions jsonb not null default '{}'::jsonb;

-- A second code that only lets people look (no drawing, no chat), and room settings.
alter table boards add column if not exists view_code text unique;
alter table boards add column if not exists settings jsonb not null default '{}'::jsonb;

-- Spotify "now listening": a private key per browser that linked an account, and what each person shares.
create table if not exists spotify_links (
  key text primary key,
  refresh_token text not null,
  access_token text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
alter table presence add column if not exists listening jsonb;
