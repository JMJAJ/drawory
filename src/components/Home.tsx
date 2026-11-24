"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { api, ApiError } from "@/lib/client/api";
import { loadMe } from "@/lib/client/identity";
import { displayCode, forgetRoom, loadRooms, parseRoomCode, type RecentRoom } from "@/lib/client/rooms";

function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 3600) return "just now";
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

// A stable, friendly colour per room so the list is easy to scan.
const ROOM_COLORS = ["#e5577a", "#4b7fe0", "#22a56b", "#8b6cf0", "#e39a1c", "#d9548f"];
function roomColor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ROOM_COLORS[h % ROOM_COLORS.length];
}

export function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<{ form: "create" | "join"; text: string } | null>(null);
  const [rooms, setRooms] = useState<RecentRoom[]>([]);

  // localStorage is browser-only, so recent rooms load after mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setRooms(loadRooms()), []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy("create");
    setError(null);
    try {
      const room = await api.createRoom(name.trim(), loadMe()?.id);
      router.push(`/b/${room.id}`);
    } catch (err) {
      setError({ form: "create", text: err instanceof Error ? err.message : "Couldn't make the room" });
      setBusy(null);
    }
  }

  async function join(e: React.FormEvent) {
    e.preventDefault();
    const id = parseRoomCode(code);
    if (!id) return setError({ form: "join", text: "That doesn't look like a room code" });
    setBusy("join");
    setError(null);
    try {
      await api.board(id);
      router.push(`/b/${id}`);
    } catch (err) {
      const text = err instanceof ApiError && err.status === 404 ? "There's no room with that code" : "Couldn't reach the room, try again";
      setError({ form: "join", text });
      setBusy(null);
    }
  }

  return (
    <main className="home">
      <div className="home-inner">
        <header className="home-head">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <span>drawory</span>
          </div>
          <div className="doodles" aria-hidden="true">
            <svg width="46" height="46" viewBox="0 0 24 24" style={{ right: 24, top: 8, ["--r" as string]: "-12deg" }}>
              <path d="M12 20.5l-7-6.8C3.2 12 2.6 10.7 2.6 9 2.6 6.2 4.8 4 7.5 4c1.7 0 3.2.8 4.5 2.3C13.3 4.8 14.8 4 16.5 4c2.7 0 4.9 2.2 4.9 5 0 1.7-.6 3-2.4 4.7z" fill="currentColor" />
            </svg>
            <svg width="34" height="34" viewBox="0 0 24 24" style={{ right: 120, top: 40, ["--r" as string]: "10deg" }}>
              <path d="M12 2l2.6 6.9L22 9.3l-5.8 4.6 2 7.1L12 17l-6.2 4 2-7.1L2 9.3l7.4-.4z" fill="currentColor" />
            </svg>
            <svg width="40" height="40" viewBox="0 0 24 24" style={{ right: 50, top: 92 }}>
              <path d="M3 14c2-4 4-4 6 0s4 4 6 0 4-4 6 0" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
          </div>
          <h1>
            Draw together,{" "}
            <span className="squiggle">
              live
              <svg viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">
                <path d="M2 8c10-6 18 4 28-1s18-5 28 0 18 4 28-1 10-3 12-1" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
              </svg>
            </span>
            .
          </h1>
          <p className="muted">An endless canvas for sketches, notes, photos and videos. Make a room and share its code, or join someone else&apos;s.</p>
        </header>

        <div className="home-cards">
          <form className="home-card" onSubmit={create}>
            <div className="home-card-icon" aria-hidden="true">
              <Icon name="plus" />
            </div>
            <h2>Create a room</h2>
            <p className="muted">You get a code to share. Anyone with it can join.</p>
            <label htmlFor="room-name" className="field-label">
              Room name <span className="muted">(optional)</span>
            </label>
            <input
              id="room-name"
              className="input"
              placeholder="Trip planning, Saturday sketches…"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {error?.form === "create" && (
              <p className="form-error" role="alert">
                {error.text}
              </p>
            )}
            <button className="btn btn-primary" disabled={busy !== null}>
              {busy === "create" ? "Creating…" : "Create room"}
            </button>
          </form>

          <form className="home-card" onSubmit={join}>
            <div className="home-card-icon blue" aria-hidden="true">
              <Icon name="link" />
            </div>
            <h2>Join a room</h2>
            <p className="muted">Type the code you were given, or paste the invite link.</p>
            <label htmlFor="room-code" className="field-label">
              Room code
            </label>
            <input
              id="room-code"
              className="input code-input"
              placeholder="K7M2QX"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            {error?.form === "join" && (
              <p className="form-error" role="alert">
                {error.text}
              </p>
            )}
            <button className="btn" disabled={busy !== null || !code.trim()}>
              {busy === "join" ? "Joining…" : "Join room"}
            </button>
          </form>
        </div>

        {rooms.length > 0 && (
          <section className="recent" aria-labelledby="recent-title">
            <h2 id="recent-title">Your rooms</h2>
            <ul>
              {rooms.map((r) => (
                <li key={r.id}>
                  <a href={`/b/${r.id}`} className="recent-room">
                    <span className="recent-bubble" aria-hidden="true" style={{ ["--c" as string]: roomColor(r.id) }}>
                      {(r.name || "U").trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="recent-text">
                      <span className="recent-name">{r.name || "Untitled room"}</span>
                      <span className="recent-meta">
                        <span className="mono">{displayCode(r.id)}</span> · {ago(r.visitedAt)}
                      </span>
                    </span>
                  </a>
                  <button
                    type="button"
                    className="icon-btn sm"
                    aria-label={`Remove ${r.name || "room"} from this list`}
                    title="Remove from this list (the room itself stays)"
                    onClick={() => {
                      forgetRoom(r.id);
                      setRooms(loadRooms());
                    }}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
