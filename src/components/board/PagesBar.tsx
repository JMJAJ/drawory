"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import type { BoardPage } from "@/lib/types";

interface Props {
  pages: BoardPage[];
  current: string;
  /** How many things are on the current page (for the clear confirmation). */
  count: number;
  onSwitch: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  /** Add and rename pages. */
  canEdit?: boolean;
  /** Clear and delete pages. */
  canClear?: boolean;
}

/** The room's pages: a switcher with add/rename/delete, and a one-click "clear this page". */
export function PagesBar({ pages, current, count, onSwitch, onAdd, onRename, onDelete, onClear, canEdit = true, canClear = true }: Props) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "clear" | { delete: string }>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const currentPage = pages.find((p) => p.id === current) ?? pages[0];

  useEffect(() => {
    if (!open && !confirm) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setConfirm(null);
        setRenaming(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setConfirm(null);
        setRenaming(null);
      }
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, confirm]);

  return (
    <div className="pages pill" ref={ref}>
      <button
        type="button"
        className="page-current"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Pages in this room"
        onClick={() => {
          setOpen((o) => !o);
          setConfirm(null);
        }}
      >
        <Icon name="note" size={16} />
        <span className="page-name">{currentPage.name}</span>
        {pages.length > 1 && <span className="page-count">{pages.findIndex((p) => p.id === currentPage.id) + 1}/{pages.length}</span>}
        <Icon name="back" size={14} style={{ transform: "rotate(-90deg)" }} />
      </button>
      {canClear && (
      <button
        type="button"
        className="icon-btn sm"
        aria-label={`Clear ${currentPage.name}`}
        title="Clear this page"
        disabled={count === 0}
        onClick={() => {
          setConfirm(confirm === "clear" ? null : "clear");
          setOpen(false);
        }}
      >
        <Icon name="eraser" size={18} />
      </button>
      )}

      {confirm === "clear" && (
        <div className="pages-pop surface" role="alertdialog" aria-label="Clear page">
          <strong>Clear {currentPage.name}?</strong>
          <p className="muted">
            Removes all {count} {count === 1 ? "thing" : "things"} on this page for everyone. You can undo it right after.
          </p>
          <div className="pages-pop-actions">
            <button type="button" className="btn" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              autoFocus
              onClick={() => {
                onClear();
                setConfirm(null);
              }}
            >
              Clear page
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="pages-pop surface" role="dialog" aria-label="Pages">
          <ul className="page-list">
            {pages.map((p, i) => (
              <li key={p.id} className={p.id === currentPage.id ? "active" : ""}>
                {renaming === p.id ? (
                  <form
                    className="page-rename"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const name = new FormData(e.currentTarget).get("name")?.toString().trim();
                      if (name) onRename(p.id, name);
                      setRenaming(null);
                    }}
                  >
                    <label className="sr-only" htmlFor={`page-name-${p.id}`}>
                      Page name
                    </label>
                    <input id={`page-name-${p.id}`} name="name" className="input" defaultValue={p.name} maxLength={40} autoFocus onKeyDown={(e) => e.stopPropagation()} />
                  </form>
                ) : (
                  <button
                    type="button"
                    className="page-item"
                    aria-current={p.id === currentPage.id}
                    onClick={() => {
                      onSwitch(p.id);
                      setOpen(false);
                    }}
                  >
                    <span className="page-index">{i + 1}</span>
                    {p.name}
                  </button>
                )}
                {confirm && typeof confirm === "object" && confirm.delete === p.id ? (
                  <button
                    type="button"
                    className="btn btn-primary page-confirm"
                    onClick={() => {
                      onDelete(p.id);
                      setConfirm(null);
                    }}
                  >
                    Delete
                  </button>
                ) : (
                  <>
                    {canEdit && (
                    <button type="button" className="icon-btn sm" aria-label={`Rename ${p.name}`} title="Rename" onClick={() => setRenaming(p.id)}>
                      <Icon name="pen" size={15} />
                    </button>
                    )}
                    {canClear && (
                    <button
                      type="button"
                      className="icon-btn sm"
                      aria-label={`Delete ${p.name}`}
                      title={pages.length > 1 ? "Delete page and everything on it" : "A room needs at least one page"}
                      disabled={pages.length <= 1}
                      onClick={() => setConfirm({ delete: p.id })}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
          <button
            type="button"
            className="btn page-add"
            onClick={() => {
              onAdd();
              setOpen(false);
            }}
          >
            <Icon name="plus" size={16} /> New page
          </button>
          )}
        </div>
      )}
    </div>
  );
}
