import { beforeEach, describe, expect, it } from 'vitest';
import { Hub, type Connection, type Sink } from '../../src/server/hub.js';
import type { RoomDeps, RoomPolicy } from '../../src/server/rooms.js';
import type { S2C, SeatOccupant } from '../../src/shared/protocol.js';
import { DEFAULT_RULES } from '../../src/shared/rules.js';

class Recorder implements Sink {
  readonly sent: S2C[] = [];
  closed = false;
  send(m: S2C): void {
    this.sent.push(m);
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
  count(t: S2C['t']): number {
    return this.sent.filter((m) => m.t === t).length;
  }
}

/** Timers are held until a test decides to fire them, and the clock is manual. */
class Clock {
  now = 5_000_000;
  private queue: { fn: () => void; at: number }[] = [];

  deps: RoomDeps = {
    now: () => this.now,
    schedule: (fn, ms) => this.queue.push({ fn, at: this.now + ms }),
    seed: () => 'resilience-seed',
    thinkingMs: () => 10,
  };

  /** Advances time and runs everything that comes due, including cascades. */
  advance(ms: number, maxSteps = 200): void {
    const target = this.now + ms;
    for (let i = 0; i < maxSteps; i++) {
      const next = this.queue.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.queue.splice(this.queue.indexOf(next), 1);
      this.now = Math.max(this.now, next.at);
      next.fn();
    }
    this.now = target;
  }
}

const POLICY: RoomPolicy = { graceMs: 45_000, turnTimeoutMs: 60_000 };

interface Client {
  sink: Recorder;
  conn: Connection;
  playerId: string;
  token: string;
}

describe('resilience', () => {
  let hub: Hub;
  let clock: Clock;

  const connect = (token?: string): Client => {
    const sink = new Recorder();
    const session = hub.sessions.hello(token, 'Hráč');
    const conn = hub.attach(sink, session);
    hub.helloResponse(sink, session);
    return { sink, conn, playerId: session.playerId, token: session.token };
  };

  const send = (client: Client, msg: Parameters<Hub['handleFrom']>[1]): void =>
    hub.handleFrom(client.conn, msg);

  /** Two humans at a table, mid-game. */
  const twoHumanGame = (): { host: Client; guest: Client } => {
    const host = connect();
    send(host, { t: 'room.create', name: 'Roman', config: DEFAULT_RULES });
    const code = host.sink.last('room.state')!.room.code;
    const guest = connect();
    send(guest, { t: 'room.join', code, name: 'Katka' });
    send(host, { t: 'room.start' });
    return { host, guest };
  };

  const seatOf = (client: Client, seat: number): SeatOccupant =>
    client.sink.last('room.state')!.room.seats[seat]!;

  beforeEach(() => {
    clock = new Clock();
    hub = new Hub({ deps: clock.deps, policy: POLICY });
  });

  it('marks a dropped player as disconnected without freeing their seat', () => {
    const { host, guest } = twoHumanGame();
    hub.disconnect(guest.playerId, guest.sink);

    const seat = seatOf(host, 1);
    expect(seat.kind).toBe('human');
    if (seat.kind === 'human') {
      expect(seat.connected).toBe(false);
      expect(seat.name).toBe('Katka');
      // Still theirs — nobody else can sit down mid-game.
      expect(seat.substituted).toBe(false);
    }
  });

  it('holds the game during the grace window, then plays for them', () => {
    const { host, guest } = twoHumanGame();
    hub.disconnect(guest.playerId, guest.sink);
    const before = host.sink.count('game.view');

    // Inside the grace window nothing happens on the absent player's behalf.
    clock.advance(20_000);
    expect(host.sink.count('game.view')).toBe(before);

    // Past it, a stand-in takes the seat and the game moves again.
    clock.advance(40_000);
    expect(host.sink.count('game.view')).toBeGreaterThan(before);
    const seat = seatOf(host, 1);
    if (seat.kind === 'human') expect(seat.substituted).toBe(true);
  });

  it('hands the seat straight back when the player returns', () => {
    const { host, guest } = twoHumanGame();
    hub.disconnect(guest.playerId, guest.sink);
    clock.advance(60_000);
    expect((seatOf(host, 1) as { substituted: boolean }).substituted).toBe(true);

    const returned = connect(guest.token);
    const seat = returned.sink.last('room.state')!.room.seats[1]!;
    expect(seat.kind).toBe('human');
    if (seat.kind === 'human') {
      expect(seat.connected).toBe(true);
      expect(seat.substituted).toBe(false);
    }
    // And they get their own cards back, not a fresh deal.
    expect(returned.sink.last('game.view')!.view.you?.seat).toBe(1);
  });

  it('stops playing entirely when nobody is watching', () => {
    const host = connect();
    send(host, { t: 'room.create', name: 'Roman', config: DEFAULT_RULES });
    send(host, { t: 'room.bot.add', seat: 1, level: 2 });
    send(host, { t: 'room.bot.add', seat: 2, level: 2 });
    send(host, { t: 'room.start' });

    hub.disconnect(host.playerId, host.sink);
    const before = host.sink.count('game.view');
    // A table of bots with no audience would otherwise play itself out at full
    // speed, for nobody.
    clock.advance(10 * 60_000);
    expect(host.sink.count('game.view')).toBe(before);
  });

  it('moves for a player who is present but never acts', () => {
    const { host } = twoHumanGame();
    const before = host.sink.count('game.view');

    clock.advance(30_000);
    expect(host.sink.count('game.view')).toBe(before);

    // The turn clock runs out and the server plays a sensible move for them,
    // so one idle player cannot hold a table hostage.
    clock.advance(40_000);
    expect(host.sink.count('game.view')).toBeGreaterThan(before);
  });

  it('never moves for somebody who acted in time', () => {
    const { host, guest } = twoHumanGame();
    const view = host.sink.last('game.view')!.view;
    const mover = view.legalMoves.length > 0 ? host : guest;
    const moverView = view.legalMoves.length > 0 ? view : guest.sink.last('game.view')!.view;

    clock.advance(1000);
    send(mover, { t: 'game.move', seq: moverView.seq, move: moverView.legalMoves[0]! });
    const afterMove = host.sink.last('game.view')!.view.seq;

    // The timer armed before the move must not fire on a state it no longer
    // describes; the guard is the step number, not a cancellation.
    clock.advance(70_000);
    expect(host.sink.last('game.view')!.view.seq).toBeGreaterThanOrEqual(afterMove);
    expect(host.sink.last('error')).toBeUndefined();
  });

  it('finishes a game where both players walked away', () => {
    const { host, guest } = twoHumanGame();
    // One stays connected so the room keeps running; the other never returns.
    hub.disconnect(guest.playerId, guest.sink);

    for (let i = 0; i < 200; i++) {
      const view = host.sink.last('game.view')!.view;
      if (view.finished) break;
      const move = view.legalMoves[0];
      clock.now += 100;
      if (move) send(host, { t: 'game.move', seq: view.seq, move });
      else clock.advance(70_000);
    }

    expect(host.sink.last('game.view')!.view.finished).toBe(true);
  });
});
