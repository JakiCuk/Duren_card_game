import { beforeEach, describe, expect, it } from 'vitest';
import { moveKey, type Move } from '../../src/engine/index.js';
import { Hub, type Connection, type Sink } from '../../src/server/hub.js';
import type { RoomDeps } from '../../src/server/rooms.js';
import type { S2C } from '../../src/shared/protocol.js';
import { DEFAULT_RULES } from '../../src/shared/rules.js';
import { PROTOCOL_VERSION } from '../../src/shared/version.js';

/** A socket that keeps everything it was sent, so tests can read the wire. */
class Recorder implements Sink {
  readonly sent: S2C[] = [];
  closed = false;

  send(message: S2C): void {
    this.sent.push(message);
  }

  close(): void {
    this.closed = true;
  }

  last<K extends S2C['t']>(t: K): Extract<S2C, { t: K }> | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const m = this.sent[i]!;
      if (m.t === t) return m as Extract<S2C, { t: K }>;
    }
    return undefined;
  }

  all<K extends S2C['t']>(t: K): Extract<S2C, { t: K }>[] {
    return this.sent.filter((m): m is Extract<S2C, { t: K }> => m.t === t);
  }
}

/** Bot timers are collected instead of fired, so tests decide when bots move. */
class Clock {
  now = 1_000_000;
  private queue: (() => void)[] = [];

  deps: RoomDeps = {
    now: () => this.now,
    schedule: (fn) => this.queue.push(fn),
    seed: () => 'test-seed',
  };

  runPending(limit = 500): number {
    let ran = 0;
    while (this.queue.length > 0 && ran < limit) {
      const next = this.queue.shift()!;
      next();
      ran++;
    }
    return ran;
  }
}

interface Client {
  sink: Recorder;
  conn: Connection;
  playerId: string;
}

describe('hub', () => {
  let hub: Hub;
  let clock: Clock;

  const connect = (token?: string, name = 'Hráč'): Client => {
    const sink = new Recorder();
    const session = hub.sessions.hello(token, name);
    const conn = hub.attach(sink, session);
    hub.helloResponse(sink, session);
    return { sink, conn, playerId: session.playerId };
  };

  const send = (client: Client, msg: Parameters<Hub['handleFrom']>[1]): void =>
    hub.handleFrom(client.conn, msg);

  beforeEach(() => {
    clock = new Clock();
    hub = new Hub({ deps: clock.deps, maxRooms: 3 });
  });

  it('mints a token on first contact and hands the same one back later', () => {
    const first = connect();
    const hello = first.sink.last('hello.ok')!;
    expect(hello.protocol).toBe(PROTOCOL_VERSION);
    expect(hello.token).toMatch(/^[0-9a-f]{32}$/);
    expect(hello.room).toBeNull();

    const again = connect(hello.token);
    expect(again.sink.last('hello.ok')!.playerId).toBe(first.playerId);
  });

  it('creates a room, shares a code, and lets a second player in', () => {
    const host = connect();
    send(host, { t: 'room.create', name: 'Roman', config: DEFAULT_RULES });
    const code = host.sink.last('room.state')!.room.code;
    expect(code).toMatch(/^[0-9A-HJ-NP-TV-Z]{5}$/);

    const guest = connect();
    send(guest, { t: 'room.join', code: code.toLowerCase(), name: 'Katka' });

    const state = guest.sink.last('room.state')!;
    expect(state.you).toBe(1);
    expect(state.room.seats[0]).toMatchObject({ kind: 'human', name: 'Roman' });
    expect(state.room.seats[1]).toMatchObject({ kind: 'human', name: 'Katka' });
    // The host is told about the arrival without having to ask.
    expect(host.sink.last('room.state')!.room.seats[1]).toMatchObject({ name: 'Katka' });
  });

  it('refuses an unknown code instead of inventing a room', () => {
    const client = connect();
    send(client, { t: 'room.join', code: 'ZZZZZ', name: 'Kto' });
    expect(client.sink.last('error')!.code).toBe('room_not_found');
  });

  it('only lets the host change the rules or start', () => {
    const host = connect();
    send(host, { t: 'room.create', name: 'Roman', config: DEFAULT_RULES });
    const code = host.sink.last('room.state')!.room.code;
    const guest = connect();
    send(guest, { t: 'room.join', code, name: 'Katka' });

    send(guest, { t: 'room.config', config: { ...DEFAULT_RULES, deckSize: 52 } });
    expect(guest.sink.last('error')!.code).toBe('not_host');
    send(guest, { t: 'room.start' });
    expect(guest.sink.last('error')!.code).toBe('not_host');

    send(host, { t: 'room.config', config: { ...DEFAULT_RULES, deckSize: 52 } });
    expect(host.sink.last('room.state')!.room.config.deckSize).toBe(52);
  });

  it('refuses to deal a table the rules cannot supply', () => {
    const host = connect();
    send(host, { t: 'room.create', name: 'Roman', config: DEFAULT_RULES });
    send(host, { t: 'room.start' });
    expect(host.sink.last('error')!.code).toBe('not_enough_players');
  });

  describe('a game against bots', () => {
    let host: Client;

    beforeEach(() => {
      host = connect();
      send(host, { t: 'room.create', name: 'Roman', config: DEFAULT_RULES });
      send(host, { t: 'room.bot.add', seat: 1, level: 2 });
      send(host, { t: 'room.start' });
    });

    it('deals and sends the player only their own hand', () => {
      const view = host.sink.last('game.view')!.view;
      expect(view.you?.seat).toBe(0);
      expect(view.you?.hand).toHaveLength(6);
      expect(view.players).toHaveLength(2);
      expect(JSON.stringify(view)).not.toContain('"deck"');
      expect(host.sink.last('room.state')!.room.phase).toBe('playing');
    });

    it('rejects a stale sequence number rather than a legal-looking move', () => {
      const view = host.sink.last('game.view')!.view;
      const move = view.legalMoves[0];
      if (!move) return; // the bot opened; nothing to test on this deal
      send(host, { t: 'game.move', seq: view.seq + 5, move });
      expect(host.sink.last('error')!.code).toBe('stale_seq');
    });

    it('rejects a move made on somebody else’s behalf', () => {
      const view = host.sink.last('game.view')!.view;
      send(host, { t: 'game.move', seq: view.seq, move: { t: 'PASS', seat: 1 } });
      expect(host.sink.last('error')!.code).toBe('not_your_seat');
    });

    it('rejects an illegal move even with the right sequence number', () => {
      const view = host.sink.last('game.view')!.view;
      // A card the player cannot possibly hold: whatever is in hand, one of
      // these 52 is not.
      const notInHand = Array.from({ length: 52 }, (_, i) => i).find(
        (c) => !(view.you?.hand ?? []).includes(c),
      )!;
      const bogus: Move = { t: 'ATTACK', seat: 0, card: notInHand };
      send(host, { t: 'game.move', seq: view.seq, move: bogus });
      expect(host.sink.last('error')!.code).toBe('illegal_move');
    });

    it('lets the bot move on its own timer and pushes the result', () => {
      const before = host.sink.all('game.view').length;
      const fired = clock.runPending(1);
      // Either the bot had a turn pending, or the human is on move — both are
      // legitimate first states, so only assert when a bot turn existed.
      if (fired > 0) expect(host.sink.all('game.view').length).toBeGreaterThan(before);
    });

    it('plays a whole game out through the socket', () => {
      for (let step = 0; step < 600; step++) {
        // Real play is spread over time; without this the rate limiter would
        // (correctly) refuse 600 moves inside one simulated second.
        clock.now += 100;
        const view = host.sink.last('game.view')!.view;
        if (view.finished) break;
        const move = view.legalMoves[0];
        if (move) send(host, { t: 'game.move', seq: view.seq, move });
        else clock.runPending(1);
      }

      const view = host.sink.last('game.view')!.view;
      expect(view.finished).toBe(true);
      expect(view.result).not.toBeNull();
      expect(host.sink.all('error')).toEqual([]);
    });
  });

  it('restores the game to a client that reconnects with its token', () => {
    const host = connect();
    send(host, { t: 'room.create', name: 'Roman', config: DEFAULT_RULES });
    send(host, { t: 'room.bot.add', seat: 1, level: 1 });
    send(host, { t: 'room.start' });
    const token = host.sink.last('hello.ok')!.token;
    const before = host.sink.last('game.view')!.view;

    // A refresh: brand new socket, same token.
    const revived = connect(token);
    const after = revived.sink.last('game.view')!.view;
    expect(after.seq).toBe(before.seq);
    expect(after.you?.hand).toEqual(before.you?.hand);
    expect(revived.sink.last('hello.ok')!.room?.code).toBe(before ? revived.sink.last('room.state')!.room.code : '');
  });

  it('closes the older socket when the same token connects twice', () => {
    const first = connect();
    const token = first.sink.last('hello.ok')!.token;
    expect(first.sink.closed).toBe(false);
    connect(token);
    expect(first.sink.closed).toBe(true);
  });

  it('throttles a client that floods the socket', () => {
    const client = connect();
    for (let i = 0; i < 40; i++) send(client, { t: 'ping' });
    expect(client.sink.last('error')!.code).toBe('rate_limited');
    // A later second is a fresh budget.
    clock.now += 1500;
    send(client, { t: 'ping' });
    expect(client.sink.sent.at(-1)).toEqual({ t: 'pong' });
  });

  it('refuses to allocate more rooms than it is configured for', () => {
    for (let i = 0; i < 3; i++) {
      const client = connect();
      send(client, { t: 'room.create', name: `H${i}`, config: DEFAULT_RULES });
      expect(client.sink.last('error')).toBeUndefined();
    }
    const extra = connect();
    send(extra, { t: 'room.create', name: 'Neskoro', config: DEFAULT_RULES });
    expect(extra.sink.last('error')!.code).toBe('server_full');
  });

  it('sweeps rooms nobody is connected to', () => {
    const host = connect();
    send(host, { t: 'room.create', name: 'Roman', config: DEFAULT_RULES });
    send(host, { t: 'room.bot.add', seat: 1, level: 1 });
    send(host, { t: 'room.start' });
    expect(hub.rooms.size).toBe(1);

    hub.disconnect(host.playerId, host.sink);
    expect(hub.sweep(60_000)).toBe(0); // still fresh
    clock.now += 120_000;
    expect(hub.sweep(60_000)).toBe(1);
    expect(hub.rooms.size).toBe(0);
  });

  it('carries chat to everyone in the room and nobody outside it', () => {
    const host = connect();
    send(host, { t: 'room.create', name: 'Roman', config: DEFAULT_RULES });
    const code = host.sink.last('room.state')!.room.code;
    const guest = connect();
    send(guest, { t: 'room.join', code, name: 'Katka' });
    const outsider = connect();

    send(guest, { t: 'chat', text: 'ahoj' });
    expect(host.sink.last('chat')!.line).toMatchObject({ name: 'Katka', text: 'ahoj', seat: 1 });
    expect(guest.sink.last('chat')!.line.text).toBe('ahoj');
    expect(outsider.sink.last('chat')).toBeUndefined();
  });

  it('keeps two independent rooms apart', () => {
    const a = connect();
    send(a, { t: 'room.create', name: 'A', config: DEFAULT_RULES });
    const b = connect();
    send(b, { t: 'room.create', name: 'B', config: DEFAULT_RULES });

    const codeA = a.sink.last('room.state')!.room.code;
    const codeB = b.sink.last('room.state')!.room.code;
    expect(codeA).not.toBe(codeB);
    send(a, { t: 'chat', text: 'len pre A' });
    expect(b.sink.last('chat')).toBeUndefined();
  });

  it('replays a game deterministically for the same seed', () => {
    const play = (): string[] => {
      const clockLocal = new Clock();
      const local = new Hub({ deps: clockLocal.deps });
      const sink = new Recorder();
      const session = local.sessions.hello(undefined, 'H');
      const conn = local.attach(sink, session);
      local.helloResponse(sink, session);
      local.handleFrom(conn, { t: 'room.create', name: 'H', config: DEFAULT_RULES });
      local.handleFrom(conn, { t: 'room.bot.add', seat: 1, level: 2 });
      local.handleFrom(conn, { t: 'room.start' });

      const played: string[] = [];
      for (let step = 0; step < 400; step++) {
        clockLocal.now += 100;
        const view = sink.last('game.view')!.view;
        if (view.finished) break;
        const move = view.legalMoves[0];
        if (move) {
          played.push(moveKey(move));
          local.handleFrom(conn, { t: 'game.move', seq: view.seq, move });
        } else if (clockLocal.runPending(1) === 0) break;
      }
      return played;
    };
    expect(play()).toEqual(play());
  });
});
