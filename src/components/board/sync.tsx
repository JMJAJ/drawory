"use client";

import { createRealtimeClient, type RealtimeClient, type SealedLiveQuery } from "@neon/realtime/client";
import { RealtimeProvider, useLiveQuery } from "@neon/realtime-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import type { ChatRow, ElementRow, LiveQueryName, PresenceRow, SignalRow } from "@/lib/types";

// Keeps the board, cursors and signals flowing whatever the connection does:
//  - Neon Realtime live queries when they're reachable (instant).
//  - Polling the snapshot route when they aren't: Realtime not configured, the site's address
//    not in its allowed origins yet, a network that blocks WebSockets, or a phone that just woke up.
//  - Reconnecting to live whenever the tab comes back, the network returns, or every 30 s while degraded.

// Public by design: the browser connects to it, and every subscription carries its own sealed query.
const REALTIME_URL = process.env.NEXT_PUBLIC_NEON_REALTIME_URL ?? "";

/** How long a query may be down before polling takes over. */
const DEGRADE_AFTER_MS = 5_000;
const RETRY_LIVE_MS = 30_000;
const POLL_MS: Record<LiveQueryName, number> = { elements: 1_500, presence: 700, signals: 1_200, chat: 1_500 };
const HIDDEN_POLL_MS = 8_000;

export type SyncStatus = "live" | "polling" | "connecting" | "offline";

interface Rows {
  elements: ElementRow;
  presence: PresenceRow;
  signals: SignalRow;
  chat: ChatRow;
}
type Data<N extends LiveQueryName> = readonly Rows[N][];
type LiveState<N extends LiveQueryName> = {
  data: Data<N> | undefined;
  status: string;
  awaitTxId: (txid: string, timeout?: number) => Promise<unknown>;
};
type Sealed = { [N in LiveQueryName]: SealedLiveQuery<Rows[N]> };

// Snapshot rows arrive as JSON; live rows have real Dates. Make them match.
const date = (v: unknown) => new Date(v as string);
const CONVERT: { [N in LiveQueryName]: (raw: Rows[N]) => Rows[N] } = {
  elements: (r) => ({ ...r, created_at: date(r.created_at), updated_at: date(r.updated_at) }),
  presence: (r) => ({ ...r, updated_at: date(r.updated_at) }),
  signals: (r) => ({ ...r, created_at: date(r.created_at) }),
  chat: (r) => ({ ...r, created_at: date(r.created_at) }),
};

/** One live query. A component rather than a hook so it can be left out when Realtime is unavailable. */
function LiveQuery<N extends LiveQueryName>({
  boardId,
  name,
  sealed,
  initialData,
  onState,
}: {
  boardId: string;
  name: N;
  sealed: SealedLiveQuery<Rows[N]>;
  initialData: Data<N> | undefined;
  onState: (name: N, state: LiveState<N>) => void;
}) {
  const refreshQuery = useCallback(() => api.seal<Rows[N]>(boardId, name), [boardId, name]);
  const q = useLiveQuery(sealed, { refreshQuery, initialData });
  useEffect(() => {
    onState(name, { data: q.data, status: q.status, awaitTxId: q.utils.awaitTxId });
  }, [name, q.data, q.status, q.utils, onState]);
  return null;
}

/** Polls one query while `on`. `pollNow` fetches immediately (e.g. right after saving). */
function usePoller<N extends LiveQueryName>(boardId: string, name: N, on: boolean) {
  const [rows, setRows] = useState<Data<N> | undefined>(undefined);
  const [ok, setOk] = useState(true);
  const version = useRef<string | undefined>(undefined);
  const tickRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (!on) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inflight: Promise<void> | null = null;
    version.current = undefined;

    const fetchOnce = async () => {
      try {
        const res = await api.snapshot<Rows[N]>(boardId, name, version.current);
        if (stopped) return;
        setOk(true);
        version.current = res.v;
        if (!res.unchanged && res.rows) setRows(res.rows.map(CONVERT[name]));
      } catch {
        if (!stopped) setOk(false);
      }
    };
    const tick = () => (inflight ??= fetchOnce().finally(() => (inflight = null)));
    const loop = async () => {
      await tick();
      if (!stopped) timer = setTimeout(loop, document.hidden ? HIDDEN_POLL_MS : POLL_MS[name]);
    };
    tickRef.current = tick;
    void loop();
    return () => {
      stopped = true;
      tickRef.current = null;
      clearTimeout(timer);
    };
  }, [boardId, name, on]);

  const pollNow = useCallback(() => tickRef.current?.() ?? Promise.resolve(), []);
  return { rows, ok, pollNow };
}

export function useBoardSync(boardId: string) {
  const [conn, setConn] = useState<{ client: RealtimeClient; sealed: Sealed } | null>(null);
  const [live, setLive] = useState<{ [N in LiveQueryName]?: LiveState<N> }>({});
  const [degraded, setDegraded] = useState(!REALTIME_URL);

  /* ---------- Live connection ---------- */
  const lastConnect = useRef(0);
  const connect = useCallback(async () => {
    if (!REALTIME_URL || Date.now() - lastConnect.current < 5_000) return;
    lastConnect.current = Date.now();
    try {
      const [elements, presence, signals, chat] = await Promise.all([
        api.seal<ElementRow>(boardId, "elements"),
        api.seal<PresenceRow>(boardId, "presence"),
        api.seal<SignalRow>(boardId, "signals"),
        api.seal<ChatRow>(boardId, "chat"),
      ]);
      // A fresh client skips any long reconnect backoff the old one had built up.
      setConn({ client: createRealtimeClient({ url: REALTIME_URL, logLevel: "warn" }), sealed: { elements, presence, signals, chat } });
    } catch {
      // Realtime isn't set up on the server, or we're offline: polling covers it.
    }
  }, [boardId]);

  useEffect(() => {
    // Connect once on mount; the state update lands after the seal requests return.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void connect();
  }, [connect]);

  const reconnect = useCallback(() => {
    lastConnect.current = 0;
    void connect();
  }, [connect]);

  // A phone that slept may still look "live" for a while on a dead socket. Coming back after
  // a while, start a fresh connection rather than wait for the old one to notice.
  useEffect(() => {
    if (!REALTIME_URL) return;
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 20_000) reconnect();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [reconnect]);

  const client = conn?.client;
  useEffect(() => () => client?.close(), [client]);

  const onState = useCallback(<N extends LiveQueryName>(name: N, state: LiveState<N>) => {
    setLive((prev) => ({ ...prev, [name]: state }));
  }, []);

  const isLive = (n: LiveQueryName) => !!conn && live[n]?.status === "live";
  const allLive = isLive("elements") && isLive("presence") && isLive("signals") && isLive("chat");

  // Fall back to polling once live has been down a little while; drop back as soon as it's up.
  useEffect(() => {
    const t = setTimeout(() => setDegraded(!allLive), allLive ? 0 : REALTIME_URL ? DEGRADE_AFTER_MS : 0);
    return () => clearTimeout(t);
  }, [allLive]);

  // Try live again when it's most likely to work, and now and then while polling.
  useEffect(() => {
    if (!REALTIME_URL || allLive) return;
    const retry = () => !document.hidden && void connect();
    const onVisible = () => !document.hidden && retry();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", retry);
    window.addEventListener("pageshow", retry);
    const timer = degraded ? setInterval(retry, RETRY_LIVE_MS) : undefined;
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", retry);
      window.removeEventListener("pageshow", retry);
      clearInterval(timer);
    };
  }, [allLive, degraded, connect]);

  /* ---------- Polling ---------- */
  const elPoll = usePoller(boardId, "elements", degraded && !isLive("elements"));
  const prPoll = usePoller(boardId, "presence", degraded && !isLive("presence"));
  const sgPoll = usePoller(boardId, "signals", degraded && !isLive("signals"));
  const chPoll = usePoller(boardId, "chat", degraded && !isLive("chat"));

  const pick = <N extends LiveQueryName>(n: N, poll: { rows: Data<N> | undefined }): Data<N> | undefined => {
    const liveData = (live[n] as LiveState<N> | undefined)?.data;
    return degraded && !isLive(n) ? poll.rows ?? liveData : liveData;
  };

  const elements = pick("elements", elPoll);
  const presence = pick("presence", prPoll);
  const signals = pick("signals", sgPoll);
  const chat = pick("chat", chPoll);

  /** Resolves once a saved change is visible in `elements`. Stable, so callers don't re-render. */
  const latest = useRef({ live: live.elements, isLive: false, pollNow: elPoll.pollNow });
  useEffect(() => {
    latest.current = { live: live.elements, isLive: isLive("elements"), pollNow: elPoll.pollNow };
  });
  const awaitTxId = useCallback(async (txid: string) => {
    const { live: el, isLive: on, pollNow } = latest.current;
    if (on && el) await el.awaitTxId(txid, 10_000).catch(() => {});
    else await pollNow();
  }, []);

  const pollersOk = elPoll.ok && prPoll.ok && sgPoll.ok && chPoll.ok;
  const status: SyncStatus = allLive ? "live" : !degraded ? "connecting" : pollersOk ? "polling" : "offline";

  const nodes =
    conn && client ? (
      <RealtimeProvider client={client}>
        <LiveQuery boardId={boardId} name="elements" sealed={conn.sealed.elements} initialData={elements} onState={onState} />
        <LiveQuery boardId={boardId} name="presence" sealed={conn.sealed.presence} initialData={presence} onState={onState} />
        <LiveQuery boardId={boardId} name="signals" sealed={conn.sealed.signals} initialData={signals} onState={onState} />
        <LiveQuery boardId={boardId} name="chat" sealed={conn.sealed.chat} initialData={chat} onState={onState} />
      </RealtimeProvider>
    ) : null;

  return { elements, presence, signals, chat, status, awaitTxId, reconnect, nodes };
}
