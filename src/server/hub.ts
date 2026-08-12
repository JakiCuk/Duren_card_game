import { PROTOCOL_VERSION } from '../shared/version.js';
import { normalizeCode, type C2S, type ChatLine, type S2C } from '../shared/protocol.js';
import { DEFAULT_RULES } from '../shared/rules.js';
import type { Room} from './rooms.js';
import { RoomError, RoomRegistry, realDeps, type RoomDeps, type ViewUpdate } from './rooms.js';
import { SessionStore, type Session } from './sessions.js';

/** Anything that can receive a frame — a real socket in production, a stub in tests. */
export interface Sink {
  send(message: S2C): void;
  close(): void;
}

export interface Connection {
  sink: Sink;
  session: Session;
  /** Timestamps of recent messages, for the rate limit. */
  recent: number[];
}

export interface HubOptions {
  maxRooms?: number;
  deps?: RoomDeps;
  /** Overrides how long bots pause. Used by tests and by BOT_DELAY_MS. */
  botDelayMs?: number;
  /** Messages per second a single connection may send before being throttled. */
  rateLimit?: number;
}

/**
 * Wires sockets to rooms.
 *
 * Concurrency control is the Node event loop: every message is handled to
 * completion before the next one starts, so "two attackers threw in at once" is
 * resolved by `seq` rather than by locking.
 */
export class Hub {
  readonly rooms: RoomRegistry;
  readonly sessions: SessionStore;
  private readonly deps: RoomDeps;
  private readonly rateLimit: number;
  /** One live connection per session: a second tab takes the seat over. */
  private byPlayer = new Map<string, Connection>();

  constructor(options: HubOptions = {}) {
    const base = options.deps ?? realDeps;
    this.deps =
      options.botDelayMs === undefined ? base : { ...base, thinkingMs: () => options.botDelayMs! };
    this.rooms = new RoomRegistry(options.maxRooms ?? 500, this.deps);
    this.sessions = new SessionStore(undefined, this.deps.now);
    this.rateLimit = options.rateLimit ?? 30;
  }

  connectionFor(playerId: string): Connection | undefined {
    return this.byPlayer.get(playerId);
  }

  /**
   * Binds a session to a socket. A second connection with the same token wins
   * and the old one is closed — that is what makes "I reopened the tab" behave
   * sensibly instead of leaving a ghost holding the seat.
   */
  attach(sink: Sink, session: Session): Connection {
    const previous = this.byPlayer.get(session.playerId);
    if (previous && previous.sink !== sink) previous.sink.close();
    const conn: Connection = { sink, session, recent: [] };
    this.byPlayer.set(session.playerId, conn);
    return conn;
  }

  /** The `hello.ok` handshake, plus a resync if the session was already in a room. */
  helloResponse(sink: Sink, session: Session): void {
    const room = session.roomCode === null ? undefined : this.rooms.find(session.roomCode);
    if (room) room.setConnected(session.playerId, true);
    else session.roomCode = null;

    sink.send({
      t: 'hello.ok',
      token: session.token,
      playerId: session.playerId,
      room: room ? room.toState() : null,
      protocol: PROTOCOL_VERSION,
    });

    if (room) {
      this.sendRoomState(room);
      const view = room.viewFor(session.playerId);
      if (view) sink.send({ t: 'game.view', view, events: [] });
    }
  }

  /** Handles one already-validated message from an attached connection. */
  handleFrom(conn: Connection, msg: C2S): void {
    if (this.throttled(conn)) {
      conn.sink.send({ t: 'error', code: 'rate_limited' });
      return;
    }
    try {
      this.route(conn, msg);
    } catch (err) {
      if (err instanceof RoomError) {
        conn.sink.send({
          t: 'error',
          code: err.code,
          ...(err.message && err.message !== err.code ? { detail: err.message } : {}),
        });
        return;
      }
      throw err;
    }
  }

  private route(conn: Connection, msg: C2S): void {
    const { session } = conn;

    switch (msg.t) {
      case 'ping':
        conn.sink.send({ t: 'pong' });
        return;

      case 'room.create': {
        session.name = msg.name;
        const room = this.rooms.create({ id: session.playerId, name: msg.name }, msg.config);
        room.onBotUpdates = (updates) => this.pushViews(updates);
        session.roomCode = room.code;
        this.sendRoomState(room);
        return;
      }

      case 'room.join': {
        session.name = msg.name;
        const room = this.rooms.get(normalizeCode(msg.code));
        room.join({ id: session.playerId, name: msg.name });
        session.roomCode = room.code;
        this.sendRoomState(room);
        return;
      }

      case 'room.leave': {
        const room = this.requireRoom(session);
        room.leave(session.playerId);
        session.roomCode = null;
        conn.sink.send({ t: 'room.closed', reason: 'empty' });
        if (room.humans().length === 0) this.rooms.close(room.code);
        else this.sendRoomState(room);
        return;
      }

      case 'room.config': {
        const room = this.requireRoom(session);
        room.setConfig(session.playerId, msg.config);
        this.sendRoomState(room);
        return;
      }

      case 'room.seat': {
        const room = this.requireRoom(session);
        room.takeSeat(session.playerId, msg.seat);
        this.sendRoomState(room);
        return;
      }

      case 'room.bot.add': {
        const room = this.requireRoom(session);
        room.addBot(session.playerId, msg.seat, msg.level);
        this.sendRoomState(room);
        return;
      }

      case 'room.bot.remove': {
        const room = this.requireRoom(session);
        room.removeBot(session.playerId, msg.seat);
        this.sendRoomState(room);
        return;
      }

      case 'room.start': {
        const room = this.requireRoom(session);
        this.pushViews(room.start(session.playerId));
        this.sendRoomState(room);
        return;
      }

      case 'room.rematch': {
        const room = this.requireRoom(session);
        this.pushViews(room.rematch(session.playerId));
        this.sendRoomState(room);
        return;
      }

      case 'game.move': {
        const room = this.requireRoom(session);
        try {
          this.pushViews(room.play(session.playerId, msg.seq, msg.move));
        } catch (err) {
          // A rejected move leaves the client holding a view it can no longer
          // act on. Sending the current one back turns "your move was refused"
          // into "here is what actually happened", which is the only useful
          // thing to say.
          if (err instanceof RoomError) {
            const view = room.viewFor(session.playerId);
            if (view) conn.sink.send({ t: 'game.view', view, events: [] });
          }
          throw err;
        }
        if (room.phase === 'finished') this.sendRoomState(room);
        return;
      }

      case 'game.resync': {
        const room = this.requireRoom(session);
        const view = room.viewFor(session.playerId);
        conn.sink.send({ t: 'room.state', room: room.toState(), you: room.seatOf(session.playerId) });
        if (view) conn.sink.send({ t: 'game.view', view, events: [] });
        return;
      }

      case 'chat': {
        const room = this.requireRoom(session);
        const line: ChatLine = {
          seat: room.seatOf(session.playerId),
          name: session.name,
          text: msg.text,
          at: this.deps.now(),
        };
        for (const { playerId } of room.humans()) {
          this.byPlayer.get(playerId)?.sink.send({ t: 'chat', line });
        }
        return;
      }

      case 'hello':
        return;
    }
  }

  /**
   * A sliding one-second window. Not a security boundary — it exists so one
   * misbehaving client cannot spin the event loop and stall everybody else's
   * room.
   */
  private throttled(conn: Connection): boolean {
    const now = this.deps.now();
    conn.recent = conn.recent.filter((t) => now - t < 1000);
    if (conn.recent.length >= this.rateLimit) return true;
    conn.recent.push(now);
    return false;
  }

  private requireRoom(session: Session): Room {
    if (session.roomCode === null) throw new RoomError('no_room');
    const room = this.rooms.find(session.roomCode);
    if (!room) {
      session.roomCode = null;
      throw new RoomError('room_not_found');
    }
    return room;
  }

  private sendRoomState(room: Room): void {
    const state = room.toState();
    for (const { playerId, seat } of room.humans()) {
      this.byPlayer.get(playerId)?.sink.send({ t: 'room.state', room: state, you: seat });
    }
  }

  pushViews(updates: ViewUpdate[]): void {
    for (const update of updates) {
      this.byPlayer
        .get(update.playerId)
        ?.sink.send({ t: 'game.view', view: update.view, events: update.events });
    }
  }

  disconnect(playerId: string, sink: Sink): void {
    const conn = this.byPlayer.get(playerId);
    // A newer tab may already own this player; do not evict it.
    if (!conn || conn.sink !== sink) return;
    this.byPlayer.delete(playerId);

    const code = conn.session.roomCode;
    const room = code === null ? undefined : this.rooms.find(code);
    if (!room) return;
    room.leave(playerId);
    if (room.humans().length === 0 && room.phase === 'lobby') this.rooms.close(room.code);
    else this.sendRoomState(room);
  }

  /** Closes rooms nobody has been connected to for a while. */
  sweep(idleMs: number): number {
    this.sessions.sweep();
    return this.rooms.sweep(idleMs).length;
  }

  defaultConfig(): typeof DEFAULT_RULES {
    return DEFAULT_RULES;
  }
}
