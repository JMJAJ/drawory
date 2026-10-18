"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { api } from "@/lib/client/api";
import { PERSON_COLORS, type Me } from "@/lib/client/identity";
import { detectLink, type DetectedLink } from "@/lib/client/media";

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, textarea, button:not([data-close])");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-label={title} style={wide ? { width: "min(640px, 100%)" } : undefined}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" data-close onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- First visit: who are you? ---------- */

export function SetupDialog({ initial, onDone }: { initial?: Me | null; onDone: (me: Me) => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? PERSON_COLORS[0].value);
  return (
    <div className="dialog-backdrop">
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Who's drawing?"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onDone({ id: initial?.id ?? crypto.randomUUID(), name: name.trim().slice(0, 40), color });
        }}
      >
        <div className="dialog-head">
          <h2>{initial ? "You" : "Who's drawing?"}</h2>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Your name and color show on your cursor and everything you add. This device remembers it.
        </p>
        <div>
          <label className="field-label" htmlFor="me-name">
            Your name
          </label>
          <input id="me-name" className="input" autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <span className="field-label">Your color</span>
          <div className="color-row" role="radiogroup" aria-label="Your color">
            {PERSON_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={color === c.value}
                aria-label={c.name}
                className="swatch"
                style={{ background: c.value, width: 40, height: 40 }}
                onClick={() => setColor(c.value)}
              />
            ))}
          </div>
        </div>
        <div className="dialog-foot">
          <button className="btn btn-primary" disabled={!name.trim()}>
            {initial ? "Save" : "Start drawing"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------- Add a link or a file ---------- */

const KINDS = ["YouTube", "Spotify", "Vimeo", "Photos", "GIFs", "Video", "Audio", "Any link"];

function describe(d: DetectedLink | null) {
  if (!d) return null;
  switch (d.kind) {
    case "youtube":
      return { label: "YouTube video", sub: "Watch together: play and pause stay in sync" };
    case "embed":
      return { label: `${d.provider} player`, sub: "Plays right on the board" };
    case "image":
      return { label: "Image", sub: "Added as a photo" };
    case "video":
      return { label: "Video", sub: "Plays right on the board" };
    case "link":
      return { label: "Link", sub: "Added as a card with a preview" };
  }
}

export function AddMediaDialog({
  initialUrl = "",
  onClose,
  onAddLink,
  onAddFiles,
}: {
  initialUrl?: string;
  onClose: () => void;
  onAddLink: (d: DetectedLink) => Promise<void>;
  onAddFiles: (files: File[]) => Promise<void>;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const detected = detectLink(url);
  const info = describe(detected);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add to board" onClose={onClose}>
      <form
        style={{ display: "flex", flexDirection: "column", gap: 18 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (detected) void run(() => onAddLink(detected));
        }}
      >
        <div>
          <label htmlFor="media-url" className="field-label">
            Paste a link
          </label>
          <div className="url-field">
            <Icon name="link" size={18} style={{ color: "var(--muted)" }} />
            <input
              id="media-url"
              type="url"
              placeholder="https://youtu.be/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
        </div>
        {detected && info && (
          <div className="detected">
            <div className="detected-thumb">
              {detected.kind === "youtube" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`https://i.ytimg.com/vi/${detected.videoId}/mqdefault.jpg`} alt="" />
              ) : detected.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={detected.url} alt="" />
              ) : (
                <Icon name={detected.kind === "link" ? "link" : "play"} size={22} style={{ color: "#fff" }} />
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <div className="eyebrow">{info.label}</div>
              <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {new URL(detected.url).hostname.replace(/^www\./, "")}
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                {info.sub}
              </div>
            </div>
          </div>
        )}
        <div className="chips">
          <span className="muted" style={{ fontSize: 13, marginRight: 4 }}>
            Works with
          </span>
          {KINDS.map((k) => (
            <span key={k} className="chip">
              {k}
            </span>
          ))}
        </div>
        <div className="or">or</div>
        <button
          type="button"
          className={`dropzone${over ? " over" : ""}`}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const files = Array.from(e.dataTransfer.files);
            if (files.length) void run(() => onAddFiles(files));
          }}
        >
          <Icon name="upload" size={28} style={{ color: "var(--accent)" }} />
          <span style={{ fontWeight: 600, fontSize: 15 }}>Drop photos, videos or audio here</span>
          <span className="muted" style={{ fontSize: 13 }}>
            or click to browse · up to 25 MB each
          </span>
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          accept="image/*,video/*,audio/*"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) void run(() => onAddFiles(files));
          }}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!detected || busy}>
            {busy ? "Adding…" : "Add to board"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Record a voice note ---------- */

export function VoiceDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (blob: Blob) => Promise<void> }) {
  const [state, setState] = useState<"idle" | "recording" | "done">("idle");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(24).fill(0.08));
  const [blob, setBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const cleanup = useRef<() => void>(() => {});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => () => cleanup.current(), []);

  async function start() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const b = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        setBlob(b);
        setPreviewUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(b);
        });
        setState("done");
      };
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const startedAt = Date.now();
      const timer = setInterval(() => {
        analyser.getByteFrequencyData(buf);
        setLevels(Array.from(buf.slice(0, 24), (v) => Math.max(0.08, v / 255)));
        const s = (Date.now() - startedAt) / 1000;
        setSeconds(s);
        if (s >= 180) rec.stop();
      }, 90);
      cleanup.current = () => {
        clearInterval(timer);
        stream.getTracks().forEach((t) => t.stop());
        void ctx.close();
      };
      rec.addEventListener("stop", () => cleanup.current());
      rec.start();
      recorder.current = rec;
      setState("recording");
    } catch {
      setError("Microphone access was blocked. Allow it in your browser to record.");
    }
  }

  return (
    <Modal title="Voice note" onClose={onClose}>
      <div className="rec-time" aria-live="polite">
        {Math.floor(seconds / 60)}:{String(Math.floor(seconds % 60)).padStart(2, "0")}
      </div>
      <div className="rec-visual" aria-hidden="true">
        {levels.map((l, i) => (
          <span key={i} style={{ height: `${l * 100}%`, opacity: state === "recording" ? 1 : 0.35 }} />
        ))}
      </div>
      {state !== "done" ? (
        <button
          type="button"
          className="rec-btn"
          aria-label={state === "recording" ? "Stop recording" : "Start recording"}
          onClick={() => (state === "recording" ? recorder.current?.stop() : start())}
        >
          <Icon name={state === "recording" ? "stop" : "mic"} size={28} />
        </button>
      ) : (
        previewUrl && <audio src={previewUrl} controls style={{ width: "100%" }} />
      )}
      <p className="muted" style={{ margin: 0, textAlign: "center", fontSize: 13 }}>
        {state === "idle" && "Tap to start. Up to 3 minutes."}
        {state === "recording" && "Recording… tap to stop."}
        {state === "done" && "Listen back, then add it to the board."}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-foot">
        {state === "done" && (
          <button
            type="button"
            className="btn"
            onClick={() => {
              setBlob(null);
              setSeconds(0);
              setState("idle");
            }}
          >
            Record again
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={!blob || busy}
          onClick={async () => {
            if (!blob) return;
            setBusy(true);
            try {
              await onAdd(blob);
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Couldn't save it");
              setBusy(false);
            }
          }}
        >
          {busy ? "Adding…" : "Add to board"}
        </button>
      </div>
    </Modal>
  );
}

/* ---------- Time capsules ---------- */

function defaultUnlock() {
  const d = new Date(Date.now() + 30 * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function CapsuleDialog({
  onClose,
  onSeal,
}: {
  onClose: () => void;
  onSeal: (v: { title: string; body: string; unlockAt: Date }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [date, setDate] = useState(defaultUnlock);
  const [time, setTime] = useState("09:00");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Seal a time capsule" onClose={onClose}>
      <form
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSeal({ title, body, unlockAt: new Date(`${date}T${time}`) });
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't seal it");
            setBusy(false);
          }
        }}
      >
        <p className="muted" style={{ margin: 0 }}>
          Nobody can open it before the date, not even you. You can both slip more notes in until then.
        </p>
        <div>
          <label className="field-label" htmlFor="cap-title">
            Name it
          </label>
          <input
            id="cap-title"
            className="input"
            placeholder="Open on our anniversary"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="cap-body">
            Your message
          </label>
          <textarea id="cap-body" className="textarea" required value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div className="row">
          <div>
            <label className="field-label" htmlFor="cap-date">
              Opens on
            </label>
            <input
              id="cap-date"
              className="input"
              type="date"
              required
              min={new Date().toISOString().slice(0, 10)}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="cap-time">
              At
            </label>
            <input id="cap-time" className="input" type="time" required value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !body.trim()}>
            <Icon name="lock" size={16} /> {busy ? "Sealing…" : "Seal it"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function CapsuleNoteDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (body: string) => Promise<void> }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title="Slip a note in" onClose={onClose}>
      <form
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onAdd(body);
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't add it");
            setBusy(false);
          }
        }}
      >
        <label className="sr-only" htmlFor="cap-note">
          Note
        </label>
        <textarea id="cap-note" className="textarea" required value={body} onChange={(e) => setBody(e.target.value)} />
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          It stays sealed with the rest until the capsule opens.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !body.trim()}>
            {busy ? "Adding…" : "Add to capsule"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function CapsuleOpenDialog({ boardId, elementId, title, onClose }: { boardId: string; elementId: string; title: string; onClose: () => void }) {
  const [items, setItems] = useState<{ id: string; author_name: string; body: string; created_at: string }[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.openCapsule(boardId, elementId).then(
      (r) => setItems(r.items),
      (e) => setError(e instanceof Error ? e.message : "Couldn't open it"),
    );
  }, [boardId, elementId]);
  return (
    <Modal title={title} onClose={onClose} wide>
      {error && <p className="form-error">{error}</p>}
      {!items && !error && <p className="muted">Opening…</p>}
      {items?.map((item) => (
        <div key={item.id} className="capsule-item">
          <div className="who">
            {item.author_name} · {new Date(item.created_at).toLocaleDateString(undefined, { dateStyle: "medium" })}
          </div>
          {item.body}
        </div>
      ))}
    </Modal>
  );
}

/* ---------- Places ---------- */

export function PlaceDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <Modal title="New place" onClose={onClose}>
      <form
        style={{ display: "flex", flexDirection: "column", gap: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) {
            onCreate(name.trim().slice(0, 40));
            onClose();
          }
        }}
      >
        <p className="muted" style={{ margin: 0 }}>
          A place is an area of the board you can jump to, like Trips, Recipes or Watchlist. It appears where you&apos;re looking now.
        </p>
        <div>
          <label className="field-label" htmlFor="place-name">
            Name
          </label>
          <input id="place-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!name.trim()}>
            Create place
          </button>
        </div>
      </form>
    </Modal>
  );
}
