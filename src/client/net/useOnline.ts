import { useCallback, useEffect, useRef, useState } from 'react';
import type { Move, PlayerView, PublicEvent } from '../../engine/index.js';
import type { C2S, ChatLine, ErrorCode, RoomState, S2C } from '../../shared/protocol.js';
import type { RuleConfig } from '../../shared/rules.js';
import { PROTOCOL_VERSION } from '../../shared/version.js';

const TOKEN_KEY = 'durak.token';
const NAME_KEY = 'durak.name';

export type ConnectionState = 'connecting' | 'online' | 'offline';

export interface OnlineState {
  connection: ConnectionState;
  /** Who the server thinks we are. Needed to tell whether we are the host. */
  playerId: string | null;
  room: RoomState | null;
  mySeat: number | null;
  view: PlayerView | null;
  events: PublicEvent[];
  chat: ChatLine[];
  error: ErrorCode | null;
}

const socketUrl = (): string => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
};

/**
 * The online session: one socket, reconnected automatically.
 *
 * The token in localStorage is the whole identity story — reconnecting sends it
 * back and the server puts the player in the seat they left, which is why a
 * refresh mid-game is not a disaster.
 */
/**
 * Lets go of a socket, whatever state it is in.
 *
 * Closing one that has not finished its handshake is legal — the browser just
 * abandons the attempt — but the `ws` package the tests run against reports it
 * as an error, and a slower machine hits that window every time React mounts
 * the effect twice. So a connecting socket is left to open and told to close
 * itself the moment it does. The reference is already gone by then, so nothing
 * can reach it either way.
 */
function discard(ws: WebSocket | null): void {
  if (ws === null) return;
  ws.onmessage = null;
  ws.onclose = null;
  if (ws.readyState === WebSocket.CONNECTING) {
    ws.onopen = () => ws.close();
    return;
  }
  ws.onopen = null;
  ws.close();
}

export function useOnline(enabled: boolean) {
  const [state, setState] = useState<OnlineState>({
    connection: 'offline',
    playerId: null,
    room: null,
    mySeat: null,
    view: null,
    events: [],
    chat: [],
    error: null,
  });

  const socket = useRef<WebSocket | null>(null);
  const retry = useRef<number>(0);
  const queue = useRef<C2S[]>([]);

  const send = useCallback((message: C2S) => {
    const ws = socket.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    // Queued rather than dropped: a click during a blip should still count.
    else queue.current.push(message);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let closed = false;
    let reconnectTimer: number | undefined;

    const connect = (): void => {
      setState((s) => ({ ...s, connection: 'connecting' }));
      const ws = new WebSocket(socketUrl());
      socket.current = ws;

      ws.onopen = () => {
        retry.current = 0;
        setState((s) => ({ ...s, connection: 'online', error: null }));
        const token = localStorage.getItem(TOKEN_KEY);
        ws.send(
          JSON.stringify({
            t: 'hello',
            locale: 'sk',
            protocol: PROTOCOL_VERSION,
            ...(token ? { token } : {}),
          } satisfies C2S),
        );
        for (const pending of queue.current.splice(0)) ws.send(JSON.stringify(pending));
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        const message = JSON.parse(event.data) as S2C;
        // A refused message leaves us holding a view we can no longer act on.
        // Asking for a fresh one is the only way back, and it is cheap.
        if (message.t === 'error' && message.code === 'rate_limited') {
          window.setTimeout(() => {
            if (socket.current?.readyState === WebSocket.OPEN) {
              socket.current.send(JSON.stringify({ t: 'game.resync' } satisfies C2S));
            }
          }, 1100);
        }
        setState((s) => reduce(s, message));
      };

      ws.onclose = () => {
        // Only disown the socket if it is still the live one. React mounts an
        // effect twice in development, so an older socket's close event can
        // arrive *after* its replacement has been installed — clearing the ref
        // unconditionally leaves a working connection that nothing can send on,
        // and every button in the room silently does nothing.
        if (socket.current === ws) socket.current = null;
        if (closed) return;
        setState((s) => ({ ...s, connection: 'offline' }));
        // Back off, but never so far that a brief blip feels like a crash.
        const delay = Math.min(1000 * 2 ** retry.current++, 10_000);
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      const live = socket.current;
      socket.current = null;
      discard(live);
    };
  }, [enabled]);

  const api = {
    createRoom: (name: string, config: RuleConfig) => {
      localStorage.setItem(NAME_KEY, name);
      send({ t: 'room.create', name, config });
    },
    joinRoom: (code: string, name: string) => {
      localStorage.setItem(NAME_KEY, name);
      send({ t: 'room.join', code, name });
    },
    leaveRoom: () => send({ t: 'room.leave' }),
    setConfig: (config: RuleConfig) => send({ t: 'room.config', config }),
    takeSeat: (seat: number) => send({ t: 'room.seat', seat }),
    addBot: (seat: number, level: 1 | 2 | 3 | 4) => send({ t: 'room.bot.add', seat, level }),
    removeBot: (seat: number) => send({ t: 'room.bot.remove', seat }),
    start: () => send({ t: 'room.start' }),
    rematch: () => send({ t: 'room.rematch' }),
    move: (seq: number, move: Move) => send({ t: 'game.move', seq, move }),
    resync: () => send({ t: 'game.resync' }),
    sendChat: (text: string) => send({ t: 'chat', text }),
    clearError: () => setState((s) => ({ ...s, error: null })),
    savedName: (): string => localStorage.getItem(NAME_KEY) ?? '',
  };

  return { ...state, ...api };
}

function reduce(state: OnlineState, message: S2C): OnlineState {
  switch (message.t) {
    case 'hello.ok':
      localStorage.setItem(TOKEN_KEY, message.token);
      return { ...state, playerId: message.playerId, room: message.room, error: null };

    case 'room.state':
      return { ...state, room: message.room, mySeat: message.you };

    case 'game.view':
      return {
        ...state,
        view: message.view,
        // The log is capped: a long game would otherwise grow without bound in
        // a tab somebody leaves open all evening.
        events: [...state.events, ...message.events].slice(-200),
      };

    case 'chat':
      return { ...state, chat: [...state.chat, message.line].slice(-50) };

    case 'room.closed':
      return { ...state, room: null, mySeat: null, view: null, events: [], chat: [] };

    case 'error':
      // A stale sequence number is the server telling us to re-render, not a
      // failure worth showing anybody.
      if (message.code === 'stale_seq') return state;
      // Being throttled is transient: the resync scheduled by the caller will
      // bring us back in line, so there is nothing to alarm the player with.
      if (message.code === 'rate_limited') return state;
      return { ...state, error: message.code };

    case 'pong':
      return state;
  }
}
