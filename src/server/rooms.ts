import { randomBytes, randomInt } from 'node:crypto';
import { createBot, isBotLevel, MAX_BOT_LEVEL, type BotLevel, type BotPolicy } from '../bots/index.js';
import {
  actorsToAct,
  applyMove,
  createGame,
  ctxOf,
  IllegalMoveError,
  isLegal,
  redact,
  redactEvents,
  type GameState,
  type Move,
  type PlayerView,
  type PublicEvent,
  type Seat,
} from '../engine/index.js';
import {
  CODE_ALPHABET,
  type ErrorCode,
  type RoomState,
  type SeatOccupant,
} from '../shared/protocol.js';
import { DEFAULT_RULES, MAX_PLAYERS, MIN_PLAYERS, validateConfig, type RuleConfig } from '../shared/rules.js';

export class RoomError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, detail?: string) {
    super(detail ?? code);
    this.name = 'RoomError';
    this.code = code;
  }
}

export interface Player {
  id: string;
  name: string;
}

/** Delivered to one participant. The room never hands out a `GameState`. */
export interface ViewUpdate {
  playerId: string;
  view: PlayerView;
  events: PublicEvent[];
}

const BOT_NAMES = ['Bot Anna', 'Bot Boris', 'Bot Cyril', 'Bot Dana', 'Bot Emil', 'Bot Fero'];

const emptySeat = (): SeatOccupant => ({ kind: 'empty' });

export interface RoomDeps {
  now: () => number;
  /** Injected so tests can run bots synchronously instead of on a timer. */
  schedule: (fn: () => void, ms: number) => void;
  /** Deterministic seeds in tests; random ones in production. */
  seed: () => string;
  /**
   * How long a bot pauses before moving, so a human can follow what happened.
   * Scaled down to nothing in tests, which would otherwise spend most of their
   * time watching a bot look thoughtful.
   */
  thinkingMs?: (level: BotLevel) => number;
}

export const realDeps: RoomDeps = {
  now: () => Date.now(),
  schedule: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    if (typeof timer.unref === 'function') timer.unref();
  },
  seed: () => randomBytes(8).toString('hex'),
};

export const defaultThinkingMs = (level: BotLevel): number => 350 + level * 150;

/**
 * One room: a lobby that becomes a game.
 *
 * The room is the only thing that touches `GameState`. Everything leaving it is
 * a redacted `PlayerView`, which is what makes "the server is the authority"
 * true rather than aspirational.
 */
export class Room {
  readonly code: string;
  config: RuleConfig;
  hostId: string;
  lastActivity: number;

  private seats: SeatOccupant[];
  private state: GameState | null = null;
  private bots = new Map<Seat, BotPolicy>();
  private lastResultReason: GameState['result'] = null;
  private readonly deps: RoomDeps;
  private botTurnScheduled = false;

  constructor(code: string, host: Player, config: RuleConfig, deps: RoomDeps) {
    this.code = code;
    this.config = config;
    this.hostId = host.id;
    this.deps = deps;
    this.lastActivity = deps.now();
    this.seats = Array.from({ length: MAX_PLAYERS }, emptySeat);
    this.seats[0] = { kind: 'human', playerId: host.id, name: host.name, connected: true };
  }

  // --- lobby ---------------------------------------------------------------

  get phase(): RoomState['phase'] {
    if (this.state === null) return 'lobby';
    return this.state.phase === 'finished' ? 'finished' : 'playing';
  }

  /** Seats in play, i.e. the prefix of occupied seats used to deal a game. */
  private occupied(): { seat: Seat; occupant: Exclude<SeatOccupant, { kind: 'empty' }> }[] {
    const out: { seat: Seat; occupant: Exclude<SeatOccupant, { kind: 'empty' }> }[] = [];
    this.seats.forEach((occupant, seat) => {
      if (occupant.kind !== 'empty') out.push({ seat, occupant });
    });
    return out;
  }

  seatOf(playerId: string): Seat | null {
    const found = this.seats.findIndex((s) => s.kind === 'human' && s.playerId === playerId);
    return found === -1 ? null : found;
  }

  humans(): { seat: Seat; playerId: string; connected: boolean }[] {
    return this.occupied()
      .filter((o) => o.occupant.kind === 'human')
      .map((o) => ({
        seat: o.seat,
        playerId: (o.occupant as Extract<SeatOccupant, { kind: 'human' }>).playerId,
        connected: (o.occupant as Extract<SeatOccupant, { kind: 'human' }>).connected,
      }));
  }

  join(player: Player): Seat {
    this.touch();
    const existing = this.seatOf(player.id);
    if (existing !== null) {
      this.setConnected(player.id, true);
      return existing;
    }
    if (this.phase !== 'lobby') throw new RoomError('room_in_progress');
    const free = this.seats.findIndex((s) => s.kind === 'empty');
    if (free === -1) throw new RoomError('room_full');
    this.seats[free] = { kind: 'human', playerId: player.id, name: player.name, connected: true };
    return free;
  }

  leave(playerId: string): void {
    this.touch();
    const seat = this.seatOf(playerId);
    if (seat === null) return;
    if (this.phase === 'lobby') {
      this.seats[seat] = emptySeat();
    } else {
      // Mid-game the seat is kept so the player can come back to it.
      this.setConnected(playerId, false);
    }
    this.promoteHostIfNeeded();
  }

  setConnected(playerId: string, connected: boolean): void {
    const seat = this.seatOf(playerId);
    if (seat === null) return;
    const occupant = this.seats[seat];
    if (occupant?.kind === 'human') this.seats[seat] = { ...occupant, connected };
  }

  private promoteHostIfNeeded(): void {
    const stillHere = this.humans().some((h) => h.playerId === this.hostId);
    if (stillHere) return;
    const next = this.humans()[0];
    if (next) this.hostId = next.playerId;
  }

  requireHost(playerId: string): void {
    if (playerId !== this.hostId) throw new RoomError('not_host');
  }

  setConfig(playerId: string, config: RuleConfig): void {
    this.requireHost(playerId);
    if (this.phase !== 'lobby') throw new RoomError('room_in_progress');
    this.config = config;
    this.touch();
  }

  takeSeat(playerId: string, seat: Seat): void {
    if (this.phase !== 'lobby') throw new RoomError('room_in_progress');
    if (seat < 0 || seat >= MAX_PLAYERS) throw new RoomError('seat_out_of_range');
    const target = this.seats[seat]!;
    if (target.kind !== 'empty') throw new RoomError('seat_taken');
    const from = this.seatOf(playerId);
    if (from === null) throw new RoomError('no_room');
    this.seats[seat] = this.seats[from]!;
    this.seats[from] = emptySeat();
    this.touch();
  }

  addBot(playerId: string, seat: Seat, level: BotLevel): void {
    this.requireHost(playerId);
    if (this.phase !== 'lobby') throw new RoomError('room_in_progress');
    if (seat < 0 || seat >= MAX_PLAYERS) throw new RoomError('seat_out_of_range');
    if (!isBotLevel(level)) throw new RoomError('bot_level_unavailable');
    if (level > MAX_BOT_LEVEL) throw new RoomError('bot_level_unavailable', `level ${level} is not built yet`);
    if (this.seats[seat]!.kind !== 'empty') throw new RoomError('seat_taken');
    this.seats[seat] = { kind: 'bot', level, name: BOT_NAMES[seat] ?? `Bot ${seat + 1}` };
    this.touch();
  }

  removeBot(playerId: string, seat: Seat): void {
    this.requireHost(playerId);
    if (this.phase !== 'lobby') throw new RoomError('room_in_progress');
    if (this.seats[seat]?.kind !== 'bot') throw new RoomError('seat_out_of_range');
    this.seats[seat] = emptySeat();
    this.touch();
  }

  // --- game ----------------------------------------------------------------

  start(playerId: string): ViewUpdate[] {
    this.requireHost(playerId);
    if (this.phase === 'playing') throw new RoomError('room_in_progress');

    const players = this.occupied();
    if (players.length < MIN_PLAYERS) throw new RoomError('not_enough_players');
    const { errors } = validateConfig(this.config, players.length);
    if (errors.length > 0) throw new RoomError('bad_config', errors.map((e) => e.code).join(','));

    // Seats are compacted for the deal: the engine indexes players 0..n-1, and
    // an empty chair between two players is a lobby concept, not a game one.
    this.seats = [
      ...players.map((p) => p.occupant),
      ...Array.from({ length: MAX_PLAYERS - players.length }, emptySeat),
    ];

    const { state, events } = createGame({
      players: players.map((_, i) => `s${i}`),
      config: this.config,
      seed: this.deps.seed(),
    });
    this.state = state;
    this.bots = new Map();
    this.seats.forEach((occupant, seat) => {
      if (occupant.kind === 'bot') {
        this.bots.set(seat, createBot(occupant.level, seat, `${this.code}:${seat}:${state.step}`));
      }
    });

    this.touch();
    const updates = this.broadcast(events);
    this.scheduleBotTurn();
    return updates;
  }

  play(playerId: string, seq: number, move: Move): ViewUpdate[] {
    if (this.state === null) throw new RoomError('no_room');
    const seat = this.seatOf(playerId);
    if (seat === null) throw new RoomError('no_room');
    if (move.seat !== seat) throw new RoomError('not_your_seat');

    // Optimistic concurrency: two attackers can genuinely try to throw in at
    // the same moment, and the loser should re-render rather than be told they
    // played something illegal.
    if (seq !== this.state.step) throw new RoomError('stale_seq');
    if (!isLegal(ctxOf(this.state), move)) throw new RoomError('illegal_move');

    return this.applyAndBroadcast(move);
  }

  private applyAndBroadcast(move: Move): ViewUpdate[] {
    const state = this.state;
    if (state === null) return [];
    let applied;
    try {
      applied = applyMove(state, move);
    } catch (err) {
      if (err instanceof IllegalMoveError) throw new RoomError('illegal_move', err.reason);
      throw err;
    }
    this.state = applied.state;
    this.lastResultReason = applied.state.result;
    this.touch();
    const updates = this.broadcast(applied.events);
    this.scheduleBotTurn();
    return updates;
  }

  /**
   * Bots move one at a time, on a timer, so a table of bots animates instead of
   * resolving instantly — and so a slow policy can never block the socket.
   */
  private scheduleBotTurn(): void {
    if (this.botTurnScheduled || this.state === null || this.state.phase !== 'bout') return;
    const seat = actorsToAct(this.state).find((s) => this.bots.has(s));
    if (seat === undefined) return;

    const bot = this.bots.get(seat)!;
    this.botTurnScheduled = true;
    this.deps.schedule(() => {
      this.botTurnScheduled = false;
      if (this.state === null || this.state.phase !== 'bout') return;
      if (!actorsToAct(this.state).includes(seat)) {
        this.scheduleBotTurn();
        return;
      }
      const updates = this.applyAndBroadcast(bot.chooseMove(redact(this.state, seat)));
      this.onBotUpdates?.(updates);
    }, (this.deps.thinkingMs ?? defaultThinkingMs)(bot.level));
  }

  /** Set by the socket layer so bot moves reach the wire too. */
  onBotUpdates: ((updates: ViewUpdate[]) => void) | null = null;

  private broadcast(events: Parameters<typeof redactEvents>[0]): ViewUpdate[] {
    const state = this.state;
    if (state === null) return [];
    for (const [seat, bot] of this.bots) bot.observe(redactEvents(events, seat));

    return this.humans().map(({ seat, playerId }) => ({
      playerId,
      view: redact(state, seat),
      events: redactEvents(events, seat),
    }));
  }

  viewFor(playerId: string): PlayerView | null {
    if (this.state === null) return null;
    const seat = this.seatOf(playerId);
    return redact(this.state, seat);
  }

  rematch(playerId: string): ViewUpdate[] {
    this.requireHost(playerId);
    if (this.phase !== 'finished') throw new RoomError('room_in_progress');
    this.state = null;
    this.bots.clear();
    return this.start(playerId);
  }

  // --- housekeeping --------------------------------------------------------

  touch(): void {
    this.lastActivity = this.deps.now();
  }

  get connectedHumans(): number {
    return this.humans().filter((h) => h.connected).length;
  }

  toState(): RoomState {
    const players = this.occupied().length;
    const verdict = validateConfig(this.config, Math.max(players, MIN_PLAYERS));
    return {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      config: this.config,
      seats: this.seats.map((s) => ({ ...s })),
      lastResult: this.lastResultReason,
      problems: {
        errors: players < MIN_PLAYERS
          ? ['not_enough_players']
          : verdict.errors.map((e) => e.code),
        warnings: verdict.warnings.map((w) => w.code),
      },
    };
  }
}

/**
 * All live rooms. In memory on purpose: the product promise is anonymous rooms
 * with a share code, and a database would buy nothing that a restart does not
 * already forfeit.
 */
export class RoomRegistry {
  private rooms = new Map<string, Room>();
  private readonly deps: RoomDeps;
  private readonly maxRooms: number;

  constructor(maxRooms: number, deps: RoomDeps = realDeps) {
    this.maxRooms = maxRooms;
    this.deps = deps;
  }

  get size(): number {
    return this.rooms.size;
  }

  create(host: Player, config: RuleConfig = DEFAULT_RULES): Room {
    if (this.rooms.size >= this.maxRooms) throw new RoomError('server_full');
    const room = new Room(this.freshCode(), host, config, this.deps);
    this.rooms.set(room.code, room);
    return room;
  }

  get(code: string): Room {
    const room = this.rooms.get(code);
    if (!room) throw new RoomError('room_not_found');
    return room;
  }

  find(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  close(code: string): void {
    this.rooms.delete(code);
  }

  /** Drops rooms nobody is connected to. Returns the codes that were closed. */
  sweep(idleMs: number): string[] {
    const cutoff = this.deps.now() - idleMs;
    const closed: string[] = [];
    for (const [code, room] of this.rooms) {
      if (room.connectedHumans === 0 && room.lastActivity < cutoff) {
        this.rooms.delete(code);
        closed.push(code);
      }
    }
    return closed;
  }

  private freshCode(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = '';
      for (let i = 0; i < 5; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new RoomError('server_full', 'could not allocate a room code');
  }
}
