import type { SealedLiveQuery } from "@neon/realtime/client";
import type { BoardMeta, ElementOp, HistoryEvent, LiveQueryName } from "@/lib/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new ApiError(401, "Sign in first");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const base = (boardId: string) => `/api/boards/${encodeURIComponent(boardId)}`;

export const api = {
  seal<Row>(boardId: string, query: LiveQueryName) {
    return request<SealedLiveQuery<Row>>(`${base(boardId)}/live`, json({ query }));
  },
  board(boardId: string) {
    return request<BoardMeta>(base(boardId));
  },
  updateBoard(boardId: string, patch: Partial<BoardMeta> & { from: string }) {
    return request<BoardMeta>(base(boardId), json(patch, "PATCH"));
  },
  applyOps(boardId: string, ops: ElementOp[], author: string) {
    return request<{ kind: "committed"; txid: string | null }>(`${base(boardId)}/elements`, json({ ops, author }));
  },
  /** keepalive lets the last update (leaving the page) finish after the tab closes. */
  presence(boardId: string, body: Record<string, unknown>, keepalive = false) {
    return request<{ now: number }>(`${base(boardId)}/presence`, { ...json(body), keepalive });
  },
  snapshot<Row>(boardId: string, query: LiveQueryName, v?: string) {
    const params = new URLSearchParams({ q: query });
    if (v) params.set("v", v);
    return request<{ rows?: Row[]; unchanged?: boolean; v?: string; now: number }>(`${base(boardId)}/snapshot?${params}`, {
      cache: "no-store",
    });
  },
  signal(boardId: string, kind: "heart" | "yt", from: string, payload: Record<string, unknown> = {}) {
    return request<void>(`${base(boardId)}/signals`, json({ kind, from, payload }));
  },
  history(boardId: string) {
    return request<HistoryEvent[]>(`${base(boardId)}/history`);
  },
  async upload(boardId: string, file: Blob, name = "file") {
    const form = new FormData();
    form.append("file", file, name);
    return request<{ id: string; url: string; mime: string }>(`${base(boardId)}/media`, { method: "POST", body: form });
  },
  sealCapsule(boardId: string, body: Record<string, unknown>) {
    return request<{ txid: string | null }>(`${base(boardId)}/capsules`, json(body));
  },
  openCapsule(boardId: string, id: string) {
    return request<{
      unlocked: boolean;
      items: { id: string; author_name: string; body: string; created_at: string }[];
    }>(`${base(boardId)}/capsules/${id}`);
  },
  addToCapsule(boardId: string, id: string, body: Record<string, unknown>) {
    return request<{ txid: string | null }>(`${base(boardId)}/capsules/${id}`, json(body));
  },
  unfurl(url: string) {
    return request<{ url: string; title: string; description?: string; image?: string; site: string }>(
      `/api/unfurl?url=${encodeURIComponent(url)}`,
    );
  },
  logout() {
    return fetch("/api/login", { method: "DELETE" });
  },
};
