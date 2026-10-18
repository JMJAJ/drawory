"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { loadMe, saveMe, type Me } from "@/lib/client/identity";
import { Board } from "./Board";
import { SetupDialog } from "./Dialogs";

export function BoardApp() {
  const params = useParams<{ boardId: string }>();
  const boardId = params.boardId ?? "";
  const validId = /^[a-z0-9-]{1,40}$/.test(boardId);
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  // localStorage only exists in the browser, so identity loads after mount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMe(loadMe()), []);

  if (!validId) return <div className="loading-screen">That board doesn&apos;t exist.</div>;
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
