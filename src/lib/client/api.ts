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
  addEmoji(boardId: string, body: { name: string; url: string; from: string }) {
    return request<{ emojis: { name: string; url: string }[] }>(`${base(boardId)}/emojis`, json(body));
  },
  viewLink(boardId: string, opts: { reset?: boolean; off?: boolean } = {}) {
    return request<{ code: string | null }>(`${base(boardId)}/view-link`, json(opts));
  },
  createRoom(name: string, by?: string) {
    return request<{ id: string; name: string }>("/api/rooms", json({ name, by }));
  },
  updateBoard(boardId: string, patch: Partial<BoardMeta> & { from: string; focusIf?: number }) {
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
  signal(boardId: string, kind: "wave" | "yt" | "summon", from: string, payload: Record<string, unknown> = {}) {
    return request<void>(`${base(boardId)}/signals`, json({ kind, from, payload }));
  },
  sendMessage(boardId: string, body: { user_id: string; name: string; color: string; body: string; thread?: string | null }) {
    return request<{ id: string; created_at: string }>(`${base(boardId)}/messages`, json(body));
  },
  react(boardId: string, body: { id: string; emoji: string; user_id: string }) {
    return request<{ ok: true }>(`${base(boardId)}/messages/react`, json(body));
  },
  history(boardId: string) {
    return request<HistoryEvent[]>(`${base(boardId)}/history`);
  },
  /**
   * Uploads a photo, video or voice note. Goes straight to Cloudinary when it's set up (no size
   * limit from our host, images served optimized from a CDN); otherwise stored in Postgres.
   */
  async upload(boardId: string, file: Blob, name = "file"): Promise<{ url: string; mime: string }> {
    const sig = await request<{ cloudName: string; apiKey: string; timestamp: number; folder: string; signature: string }>(
      `${base(boardId)}/upload-signature`,
      { method: "POST" },
    ).catch((e) => {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    });
    if (!sig) {
      const form = new FormData();
      form.append("file", file, name);
      return request<{ id: string; url: string; mime: string }>(`${base(boardId)}/media`, { method: "POST", body: form });
    }
    const form = new FormData();
    form.append("file", file, name);
    form.append("api_key", sig.apiKey);
    form.append("timestamp", String(sig.timestamp));
    form.append("folder", sig.folder);
    form.append("signature", sig.signature);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/auto/upload`, { method: "POST", body: form });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.secure_url) throw new ApiError(res.status, body?.error?.message ?? "Upload failed");
    const mime = file.type || (body.resource_type === "image" ? `image/${body.format}` : `video/${body.format}`);
    // Photos: let Cloudinary pick the best format and quality for each browser (keeps GIFs animated).
    const url = body.resource_type === "image" ? String(body.secure_url).replace("/upload/", "/upload/f_auto,q_auto/") : body.secure_url;
    return { url, mime };
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
