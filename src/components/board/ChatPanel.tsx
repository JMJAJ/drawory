"use client";

import { useEffect } from "react";
import { Icon } from "@/components/icons";
import type { Me } from "@/lib/client/identity";
import type { ChatRow } from "@/lib/types";
import { ChatThread } from "./ChatThread";

/** The room-wide chat, opened from the top bar. Chat boxes on the board have their own threads. */
export function ChatPanel({
  messages,
  me,
  onClose,
  onSend,
}: {
  messages: readonly ChatRow[];
  me: Me;
  onClose: () => void;
  onSend: (body: string) => Promise<{ id: string }>;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside className="chat surface" aria-label="Room chat">
      <div className="chat-head">
        <h2>Room chat</h2>
        <button type="button" className="icon-btn sm" aria-label="Close chat" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <ChatThread messages={messages} me={me} onSend={onSend} inputId="room-chat-input" autoFocus />
    </aside>
  );
}
