"use client";

import { createRealtimeClient } from "@neon/realtime/client";
import { RealtimeProvider } from "@neon/realtime-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { loadMe, saveMe, type Me } from "@/lib/client/identity";
import type { ElementRow, PresenceRow, SignalRow } from "@/lib/types";
import { Board, type Sealed } from "./Board";
import { SetupDialog } from "./Dialogs";

// Public by design: the browser connects to it, and every subscription carries its own sealed query.
const REALTIME_URL = process.env.NEXT_PUBLIC_NEON_REALTIME_URL ?? "";

export function BoardApp() {
  const params = useParams<{ boardId: string }>();
  const boardId = params.boardId ?? "";
  const validId = /^[a-z0-9-]{1,40}$/.test(boardId);
  // One Realtime client per page load, created in the browser.
  const [client] = useState(() => createRealtimeClient({ url: REALTIME_URL, logLevel: "warn" }));
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [sealed, setSealed] = useState<Sealed | null>(null);
  const [error, setError] = useState("");

  // localStorage only exists in the browser, so identity loads after mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMe(loadMe()), []);

  useEffect(() => {
    if (!validId) return;
    let cancelled = false;
    Promise.all([
      api.seal<ElementRow>(boardId, "elements"),
      api.seal<PresenceRow>(boardId, "presence"),
      api.seal<SignalRow>(boardId, "signals"),
    ]).then(
      ([elements, presence, signals]) => !cancelled && setSealed({ elements, presence, signals }),
      (e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't open the board"),
    );
    return () => {
      cancelled = true;
    };
  }, [boardId, validId]);

  useEffect(() => () => client.close(), [client]);

  if (!validId) return <div className="loading-screen">That board doesn&apos;t exist.</div>;
  if (!REALTIME_URL) return <div className="loading-screen">NEXT_PUBLIC_NEON_REALTIME_URL isn&apos;t set. Run `neon env pull`.</div>;
  if (me === undefined) return null;
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
  if (error) {
    return (
      <div className="loading-screen" role="alert">
        {error}
      </div>
    );
  }
  if (!sealed) return <div className="loading-screen">Opening your board…</div>;

  return (
    <RealtimeProvider client={client}>
      <Board
        boardId={boardId}
        me={me}
        sealed={sealed}
        onChangeMe={(next) => {
          saveMe(next);
          setMe(next);
        }}
      />
    </RealtimeProvider>
  );
}
