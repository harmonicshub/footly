/**
 * REALTIME
 * --------
 * One socket for the whole app. Screens subscribe to the events they
 * are showing and unsubscribe on blur — a punter scrolling a fixture
 * list should not be receiving price updates for 300 matches.
 *
 * Reconnect strategy assumes the connection WILL drop, repeatedly.
 * On reconnect we do not replay missed messages; we re-subscribe and
 * take a fresh snapshot. Replaying a backlog of stale prices onto a
 * live slip is worse than a one-second gap.
 */

import React, { createContext, useContext, useEffect, useMemo, useRef, useCallback } from "react";
import { AppState, type AppStateStatus } from "react-native";

const WS_URL = process.env.EXPO_PUBLIC_WS_URL ?? "wss://api.footly.ng/stream";

type OddsMessage =
  | { type: "odds"; marketId: string; outcomes: { id: string; price: number; version: number }[] }
  | { type: "market_suspended"; marketId: string; reason: string }
  | { type: "market_open"; marketId: string }
  | { type: "market_closed"; marketId: string }
  | { type: "score"; eventId: string; home: number; away: number; minute: number }
  | { type: "balance"; cashKobo: number; bonusKobo: number }
  | { type: "bet_settled"; betId: string; status: string; payoutKobo: number };

type Handler = (m: OddsMessage) => void;

const Ctx = createContext<{
  subscribe: (eventIds: string[], handler: Handler) => () => void;
  connected: () => boolean;
}>(null as never);

export const useRealtime = () => useContext(Ctx);

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const ws = useRef<WebSocket | null>(null);
  const handlers = useRef(new Set<Handler>());
  const subscriptions = useRef(new Map<string, number>()); // eventId → refcount
  const backoff = useRef(800);
  const closing = useRef(false);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);

  const send = (payload: unknown) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(payload));
    }
  };

  const connect = useCallback(() => {
    if (closing.current) return;
    if (ws.current && ws.current.readyState <= WebSocket.OPEN) return;

    const socket = new WebSocket(WS_URL);
    ws.current = socket;

    socket.onopen = () => {
      backoff.current = 800;
      // Re-subscribe to everything the mounted screens still care about.
      const ids = [...subscriptions.current.keys()];
      if (ids.length) send({ action: "subscribe", eventIds: ids, snapshot: true });

      heartbeat.current = setInterval(() => send({ action: "ping" }), 20_000);
    };

    socket.onmessage = (e) => {
      let msg: OddsMessage;
      try { msg = JSON.parse(String(e.data)); } catch { return; }
      handlers.current.forEach((h) => {
        try { h(msg); } catch { /* one bad screen must not kill the socket */ }
      });
    };

    socket.onclose = () => {
      if (heartbeat.current) clearInterval(heartbeat.current);
      if (closing.current) return;
      setTimeout(connect, backoff.current);
      backoff.current = Math.min(backoff.current * 2, 20_000);
    };

    socket.onerror = () => socket.close();
  }, []);

  /* Connect on mount; drop the socket in the background. Holding a
     socket open behind the home screen drains battery and data for
     prices nobody is looking at. */
  useEffect(() => {
    connect();

    const onState = (s: AppStateStatus) => {
      if (s === "active") { closing.current = false; connect(); }
      else { closing.current = true; ws.current?.close(); }
    };

    const sub = AppState.addEventListener("change", onState);
    return () => {
      closing.current = true;
      sub.remove();
      if (heartbeat.current) clearInterval(heartbeat.current);
      ws.current?.close();
    };
  }, [connect]);

  const subscribe = useCallback((eventIds: string[], handler: Handler) => {
    handlers.current.add(handler);

    const fresh: string[] = [];
    for (const id of eventIds) {
      const n = subscriptions.current.get(id) ?? 0;
      subscriptions.current.set(id, n + 1);
      if (n === 0) fresh.push(id);
    }
    if (fresh.length) send({ action: "subscribe", eventIds: fresh, snapshot: true });

    return () => {
      handlers.current.delete(handler);
      const drop: string[] = [];
      for (const id of eventIds) {
        const n = (subscriptions.current.get(id) ?? 1) - 1;
        if (n <= 0) { subscriptions.current.delete(id); drop.push(id); }
        else subscriptions.current.set(id, n);
      }
      if (drop.length) send({ action: "unsubscribe", eventIds: drop });
    };
  }, []);

  const connected = useCallback(() => ws.current?.readyState === WebSocket.OPEN, []);
  const value = useMemo(() => ({ subscribe, connected }), [subscribe, connected]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ------------------------------------------------------------------ */
/* Screen-level hook                                                   */
/* ------------------------------------------------------------------ */

/**
 * Usage in a fixture list or market board:
 *
 *   useOdds(visibleEventIds, (msg) => {
 *     if (msg.type === "odds") applyPrices(msg);
 *     if (msg.type === "market_suspended") markSuspended(msg.marketId);
 *   });
 *
 * Pass only the events currently on screen. Recompute on scroll if the
 * list is long — subscribing to a whole league's worth of live prices
 * is the fastest way to burn someone's data bundle.
 */
export function useOdds(eventIds: string[], handler: Handler) {
  const { subscribe } = useRealtime();
  const key = eventIds.join(",");
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!eventIds.length) return;
    return subscribe(eventIds, (m) => ref.current(m));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, subscribe]);
}
