"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { EMOJIS } from "@/lib/emojis";

/** Names a drawing that's about to become a chat emoji. */
export function EmojiMaker({ taken, onMake, onClose }: { taken: string[]; onMake: (name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = name.trim().replace(/^:|:$/g, "");
  const clash = [...taken, ...EMOJIS.map((e) => e.name)].some((n) => n.toLowerCase() === clean.toLowerCase());
  const bad = !/^[A-Za-z0-9_]{2,32}$/.test(clean);
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form
        className="dialog emoji-maker"
        role="dialog"
        aria-modal="true"
        aria-label="Make an emoji"
        onSubmit={async (e) => {
          e.preventDefault();
          if (bad) return setError("Use 2 to 32 letters, numbers or _ (no spaces)");
          if (clash) return setError("There's already an emoji called that");
          setBusy(true);
          setError(null);
          try {
            await onMake(clean);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't make it. Try again.");
            setBusy(false);
          }
        }}
      >
        <div className="dialog-head">
          <h2>Make an emoji</h2>
          <button type="button" className="icon-btn sm" aria-label="Close" onClick={onClose} disabled={busy}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          The drawing becomes an emoji everyone in this room can use in chat.
        </p>
        <label className="field-label" htmlFor="emoji-name">
          Name
        </label>
        <div className="emoji-name-field">
          <span>:</span>
          <input
            id="emoji-name"
            className="input"
            autoFocus
            placeholder="ourcat"
            value={name}
            maxLength={34}
            onChange={(e) => {
              setName(e.target.value.replace(/\s+/g, "_"));
              setError(null);
            }}
          />
          <span>:</span>
        </div>
        {error && <p className="field-error">{error}</p>}
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !clean}>
            {busy ? "Making it…" : "Make emoji"}
          </button>
        </div>
      </form>
    </div>
  );
}
