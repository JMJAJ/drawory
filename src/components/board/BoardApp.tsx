"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { loadMe, saveMe, type Me } from "@/lib/client/identity";
import { displayCode, forgetRoom } from "@/lib/client/rooms";
import { Board } from "./Board";
import { SetupDialog } from "./Dialogs";

type RoomState = "checking" | "ok" | "missing" | "error";

export function BoardApp({ viewOnly = false }: { viewOnly?: boolean }) {
  const params = useParams<{ boardId: string }>();
  const boardId = params.boardId ?? "";
  const validId = viewOnly ? /^view-[a-z0-9]{10}$/.test(boardId) : /^[a-z0-9-]{1,40}$/.test(boardId);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [room, setRoom] = useState<RoomState>("checking");

  // localStorage only exists in the browser, so identity loads after mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMe(loadMe()), []);

  // Make sure the room exists before connecting, so a mistyped code gets a clear answer.
  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    api.board(boardId).then(
      () => !cancelled && setRoom("ok"),
      (e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          if (!viewOnly) forgetRoom(boardId);
          setRoom("missing");
        } else setRoom("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [boardId, validId]);

  if (!validId || room === "missing" || room === "error") {
    return (
      <main className="login">
        <div className="login-card">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <span>drawory</span>
          </div>
          <h1>{room === "error" ? "Can't reach this room" : "No room here"}</h1>
          <p className="muted">
            {room === "error"
              ? "Check your connection and try again."
              : viewOnly
                ? "This view-only link doesn't work anymore. Ask for a new one."
                : `There's no room with the code ${validId ? displayCode(boardId) : "you used"}. Check the code, or make a new room.`}
          </p>
          <Link className="btn btn-primary" href="/">
            Go to rooms
          </Link>
        </div>
      </main>
    );
  }
  if (me === undefined || room === "checking") return <div className="loading-screen">Opening the room…</div>;
  if (viewOnly) {
    // Viewers don't need a name: they can't draw or chat.
    return <Board boardId={boardId} me={me ?? { id: `viewer-${boardId}`, name: "Viewer", color: "#8A8A96" }} viewOnly onChangeMe={() => {}} />;
  }
  if (me === null) {
    return (
      <SetupDialog
        onDone={(next) => {
          saveMe(next);
          setMe(next);
        }}
      />
    );
  }
  return (
    <Board
      boardId={boardId}
      me={me}
      onChangeMe={(next) => {
        saveMe(next);
        setMe(next);
      }}
    />
  );
}
