"use client";

import { useEffect, useState } from "react";

/** "Mia wants to show you something": takes you there after a short countdown, unless you skip. */
export function SummonBanner({ name, onGo, onSkip }: { name: string; onGo: () => void; onSkip: () => void }) {
  const [left, setLeft] = useState(3);
  useEffect(() => {
    if (left <= 0) {
      onGo();
      return;
    }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left, onGo]);
  return (
    <div className="summon-banner surface" role="alert">
      <span>
        <strong>{name}</strong> wants to show you something. Taking you there in {Math.max(left, 0)}…
      </span>
      <button type="button" className="btn btn-primary" onClick={onGo}>
        Go now
      </button>
      <button type="button" className="btn btn-ghost" onClick={onSkip}>
        Stay here
      </button>
    </div>
  );
}
