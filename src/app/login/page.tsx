"use client";

import { useState } from "react";

export default function LoginPage() {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => null))?.error ?? "Couldn't sign in");
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next");
    // Only same-site paths, never an absolute URL from the query string.
    window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  }

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>drawory</span>
        </div>
        <h1>Welcome back</h1>
        <p className="muted">This site is protected. Enter its passcode.</p>
        <label htmlFor="passcode" className="field-label">
          Passcode
        </label>
        <input
          id="passcode"
          className="input"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" disabled={busy || !passcode}>
          {busy ? "Opening…" : "Open our board"}
        </button>
      </form>
    </main>
  );
}
