"use client";

import { createRealtimeClient } from "@neon/realtime/client";
import { RealtimeProvider } from "@neon/realtime-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import { loadMe, saveMe, type Me } from "@/lib/client/identity";
import type { ElementRow, PresenceRow, SignalRow } from "@/lib/types";
import { Board, type Sealed } from "./Board";
import { SetupDialog } from "./Dialogs";

export function BoardApp({ boardId, realtimeUrl }: { boardId: string; realtimeUrl: string }) {
  // One Realtime client per page load, created in the browser.
  const [client] = useState(() => createRealtimeClient({ url: realtimeUrl, logLevel: "warn" }));
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [sealed, setSealed] = useState<Sealed | null>(null);
  const [error, setError] = useState("");

  // localStorage only exists in the browser, so identity loads after mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMe(loadMe()), []);

  useEffect(() => {
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
  }, [boardId]);

  useEffect(() => () => client.close(), [client]);

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
