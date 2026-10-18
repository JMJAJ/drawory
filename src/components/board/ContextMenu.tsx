"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons";

export type MenuItem = { label: string; icon?: IconName; hint?: string; danger?: boolean; run: () => void } | "sep";

/** The right-click menu: everything you can do with what's under the pointer. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Keep it on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
  }, [x, y]);

  useEffect(() => {
    const away = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("wheel", onClose, { passive: true });
    window.addEventListener("keydown", key);
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("wheel", onClose);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu surface"
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }}
    >
      {items.map((it, i) =>
        it === "sep" ? (
          <div key={i} className="context-sep" role="separator" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={`context-item${it.danger ? " danger" : ""}`}
            onClick={() => {
              onClose();
              it.run();
            }}
          >
            {it.icon ? <Icon name={it.icon} size={16} /> : <span className="context-icon-space" />}
            <span className="context-label">{it.label}</span>
            {it.hint && <span className="context-hint">{it.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}
