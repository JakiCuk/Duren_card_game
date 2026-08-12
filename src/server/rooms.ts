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

/** Level used when the server has to play for somebody who is not there. */
const SUBSTITUTE_LEVEL: BotLevel = 2;

export interface RoomPolicy {
  /**
   * How long a disconnected player's clock is held before a bot takes over.
   * Short enough that nobody waits around, long enough to survive a tunnel.
   */
  graceMs: number;
  /** How long a connected player may think before the server moves for them. */
  turnTimeoutMs: number | null;
}

export const DEFAULT_POLICY: RoomPolicy = { graceMs: 45_000, turnTimeoutMs: 60_000 };

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
  private readonly policy: RoomPolicy;
  /** Substitutes for players who left the table, keyed by seat. */
  private standIns = new Map<Seat, BotPolicy>();
  private awaySince = new Map<Seat, number>();
  /** Seats a stand-in has actually taken over, as opposed to merely away. */
  private standInActive = new Set<Seat>();
  /** Bumped whenever the seat list changes in a way clients should see. */
  private seatsVersion = 0;
  /** The step a turn was scheduled for; a newer step means the timer is stale. */
  private scheduledForStep: number | null = null;

  constructor(code: string, host: Player, config: RuleConfig, deps: RoomDeps, policy: RoomPolicy = DEFAULT_POLICY) {
    this.code = code;
    this.config = config;
    this.hostId = host.id;
    this.deps = deps;
    this.policy = policy;
    this.lastActivity = deps.now();
    this.seats = Array.from({ length: MAX_PLAYERS }, emptySeat);
    this.seats[0] = { kind: 'human', playerId: host.id, name: host.name, connected: true, substituted: false };
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
    this.seats[free] = {
      kind: 'human',
      playerId: player.id,
      name: player.name,
      connected: true,
      substituted: false,
    };
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
    if (occupant?.kind !== 'human') return;
    this.seats[seat] = { ...occupant, connected };

    if (connected) {
      // Reclaiming a seat retires the stand-in immediately, even mid-bout.
      this.awaySince.delete(seat);
      this.standIns.delete(seat);
      this.standInActive.delete(seat);
    } else {
      this.awaySince.set(seat, this.deps.now());
    }
    this.seatsVersion++;
    this.scheduleAutoTurn();
  }

  /** Whether a stand-in is currently playing this seat. */
  substituted(seat: Seat): boolean {
    return this.standInActive.has(seat);
  }

  /** Changes clients should be told about, without diffing the whole room. */
  get version(): number {
    return this.seatsVersion;
  }

  private graceExpired(seat: Seat): boolean {
    const since = this.awaySince.get(seat);
    return since !== undefined && this.deps.now() - since >= this.policy.graceMs;
  }

  /** True while at least one human is still watching. Nothing runs otherwise. */
  private get anyoneWatching(): boolean {
    return this.humans().some((h) => h.connected);
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
    this.scheduleAutoTurn();
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

    // Playing for yourself retires the stand-in the turn clock installed.
    if (this.standInActive.delete(seat)) {
      this.standIns.delete(seat);
      this.seatsVersion++;
    }
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
    this.scheduleAutoTurn();
    return updates;
  }

  /**
   * Decides who, if anyone, the server should move for next.
   *
   * Three cases share one path because they are the same problem: a seat that
   * needs a move and no human at the keyboard. A bot plays its own turn; an
   * absent player gets a stand-in once their grace period is up; a present
   * player who never moves gets one after the turn clock runs out.
   *
   * Instead of cancelling timers, each one records the step it was armed for
   * and does nothing if the game has moved on. That is impossible to get wrong,
   * which cancellation is not.
   */
  private scheduleAutoTurn(): void {
    if (this.state === null || this.state.phase !== 'bout') return;
    // With nobody watching, a room of bots would burn CPU for an empty table.
    if (!this.anyoneWatching) return;

    const step = this.state.step;
    if (this.scheduledForStep === step) return;

    const actors = actorsToAct(this.state);

    const botSeat = actors.find((s) => this.bots.has(s));
    if (botSeat !== undefined) {
      const bot = this.bots.get(botSeat)!;
      this.arm(step, botSeat, bot, (this.deps.thinkingMs ?? defaultThinkingMs)(bot.level));
      return;
    }

    const awaySeat = actors.find((s) => this.awaySince.has(s));
    if (awaySeat !== undefined) {
      const since = this.awaySince.get(awaySeat)!;
      const delay = Math.max(this.policy.graceMs - (this.deps.now() - since), 0) + 50;
      this.arm(step, awaySeat, this.standInFor(awaySeat), delay);
      return;
    }

    if (this.policy.turnTimeoutMs !== null && actors.length > 0) {
      const seat = actors[0]!;
      this.arm(step, seat, this.standInFor(seat), this.policy.turnTimeoutMs);
    }
  }

  private standInFor(seat: Seat): BotPolicy {
    let bot = this.standIns.get(seat);
    if (!bot) {
      bot = createBot(SUBSTITUTE_LEVEL, seat, `${this.code}:stand-in:${seat}`);
      this.standIns.set(seat, bot);
    }
    return bot;
  }

  private arm(step: number, seat: Seat, bot: BotPolicy, delay: number): void {
    this.scheduledForStep = step;
    this.deps.schedule(() => {
      this.scheduledForStep = null;
      const state = this.state;
      // Stale timer: somebody already moved, so this one has nothing to say.
      if (state === null || state.phase !== 'bout' || state.step !== step) {
        this.scheduleAutoTurn();
        return;
      }
      if (!actorsToAct(state).includes(seat)) {
        this.scheduleAutoTurn();
        return;
      }
      if (!this.bots.has(seat)) {
        const away = this.awaySince.has(seat);
        // Somebody who came back within grace keeps their turn, and a present
        // player only loses it once the turn clock has actually run out.
        if (away && !this.graceExpired(seat)) {
          this.scheduleAutoTurn();
          return;
        }
        if (!away && this.policy.turnTimeoutMs === null) return;
        if (!this.standInActive.has(seat)) {
          this.standInActive.add(seat);
          this.seatsVersion++;
        }
      }
      const updates = this.applyAndBroadcast(bot.chooseMove(redact(state, seat)));
      this.onBotUpdates?.(updates);
    }, delay);
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
    this.seatsVersion++;
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
      seats: this.seats.map((s, seat) =>
        s.kind === 'human' ? { ...s, substituted: this.standInActive.has(seat) } : { ...s },
      ),
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

  private readonly policy: RoomPolicy;

  constructor(maxRooms: number, deps: RoomDeps = realDeps, policy: RoomPolicy = DEFAULT_POLICY) {
    this.maxRooms = maxRooms;
    this.deps = deps;
    this.policy = policy;
  }

  get size(): number {
    return this.rooms.size;
  }

  create(host: Player, config: RuleConfig = DEFAULT_RULES): Room {
    if (this.rooms.size >= this.maxRooms) throw new RoomError('server_full');
    const room = new Room(this.freshCode(), host, config, this.deps, this.policy);
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
