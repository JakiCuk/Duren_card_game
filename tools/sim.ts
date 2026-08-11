/**
 * Headless game driver: random play for fuzzing, bot play for benchmarking.
 *
 * Every participant is asked for a move through a redacted `PlayerView`, never
 * from the `GameState`. That is not just tidiness — it means the fuzzer
 * exercises the redaction path on every single move of every single game.
 *
 *   pnpm sim -- --games 10000 --players 2
 *   pnpm sim -- --games 500 --bots 2,1
 */
import { pathToFileURL } from 'node:url';
import { createBot, isBotLevel, type BotLevel, type BotPolicy } from '../src/bots/index.js';
import {
  actorsToAct,
  applyMove,
  assertInvariants,
  createGame,
  hashState,
  moveKey,
  redact,
  redactEvents,
  type DeckSize,
  type GameState,
  type Move,
  type PlayerId,
  type PlayerView,
  type Seat,
} from '../src/engine/index.js';
import { nextInt, seedRng, type RngState } from '../src/engine/rng.js';
import {
  DEFAULT_RULES,
  isPlayable,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type AttackCap,
  type AttackerScope,
  type RuleConfig,
  type ThrowInAfterTakeCap,
} from '../src/shared/rules.js';

/** Guards against livelocks: no legal Durak game comes anywhere near this. */
export const MAX_STEPS = 2000;

export type Chooser = (view: PlayerView, seat: Seat) => Move;

const CAPS: AttackCap[] = [
  { kind: 'defenderHand' },
  { kind: 'unlimited' },
  { kind: 'fixed', n: 3 },
  { kind: 'fixed', n: 6 },
];
const AFTER_TAKE: ThrowInAfterTakeCap[] = ['sameAsAttack', 'defenderHandAtBoutStart', 'unlimited'];
const SCOPES: AttackerScope[] = ['all', 'neighbours'];

/**
 * A random *playable* rule configuration and table size.
 *
 * Sampling the whole switch matrix is the only practical way to be sure the
 * combinations nobody thought about still terminate and still conserve cards —
 * which is exactly what the perevodnoy and cap options put at risk.
 */
export function randomSetup(
  rng: RngState,
  fixedPlayers?: number,
): { config: RuleConfig; players: number } {
  for (let attempt = 0; attempt < 200; attempt++) {
    const players = fixedPlayers ?? MIN_PLAYERS + nextInt(rng, MAX_PLAYERS - MIN_PLAYERS + 1);
    const transferOn = nextInt(rng, 2) === 0;
    const config: RuleConfig = {
      deckSize: nextInt(rng, 2) === 0 ? 36 : 52,
      handSize: 4 + nextInt(rng, 3),
      maxTableSlots: 4 + nextInt(rng, 5),
      attackCap: CAPS[nextInt(rng, CAPS.length)]!,
      throwInAfterTakeCap: AFTER_TAKE[nextInt(rng, AFTER_TAKE.length)]!,
      firstBoutCapFive: nextInt(rng, 2) === 0,
      throwInAfterTake: nextInt(rng, 4) > 0,
      attackerScope: SCOPES[nextInt(rng, SCOPES.length)]!,
      transfer: {
        enabled: transferOn,
        withTrumpReveal: transferOn && nextInt(rng, 2) === 0,
        allowChains: transferOn && nextInt(rng, 2) === 0,
      },
      firstAttacker: nextInt(rng, 2) === 0 ? 'lowestTrump' : 'random',
      defenderMustBeatAll: nextInt(rng, 3) === 0,
      trumpCardVisible: nextInt(rng, 4) > 0,
    };
    if (isPlayable(config, players)) return { config, players };
  }
  return { config: DEFAULT_RULES, players: fixedPlayers ?? 2 };
}

export interface PlayOptions {
  seed: number | string;
  players?: number;
  config?: RuleConfig;
  /** One chooser per seat. Defaults to uniform random legal play. */
  choosers?: readonly Chooser[];
  /** Notified with each seat's redacted events; used to feed bot memories. */
  onEvents?: (seat: Seat, events: ReturnType<typeof redactEvents>) => void;
  /** Assert invariants after every move. Off makes the driver roughly 3x faster. */
  check?: boolean;
}

export interface GameOutcome {
  seed: number | string;
  config: RuleConfig;
  playerIds: PlayerId[];
  moves: Move[];
  finalHash: string;
  state: GameState;
  steps: number;
}

function pick<T>(rng: RngState, xs: readonly T[]): T {
  if (xs.length === 0) throw new Error('pick from an empty list');
  return xs[nextInt(rng, xs.length)]!;
}

export function randomChooser(rng: RngState): Chooser {
  return (view) => pick(rng, view.legalMoves);
}

export function playGame(opts: PlayOptions): GameOutcome {
  const playerCount = opts.players ?? 2;
  const config = opts.config ?? DEFAULT_RULES;
  const check = opts.check ?? true;
  const playerIds: PlayerId[] = Array.from({ length: playerCount }, (_, i) => `p${i}`);

  // The driver's randomness is seeded separately from the game's, so shuffling
  // the deck and choosing among simultaneous actors never perturb one another.
  const rng = seedRng(`driver:${String(opts.seed)}`);
  const fallback = randomChooser(rng);
  const chooserFor = (seat: Seat): Chooser => opts.choosers?.[seat] ?? fallback;

  const created = createGame({ players: playerIds, config, seed: opts.seed });
  let state = created.state;
  if (check) assertInvariants(state, 'after deal');
  deliver(opts, created.events, playerCount);

  const moves: Move[] = [];
  while (state.phase === 'bout') {
    if (moves.length >= MAX_STEPS) throw new Error(`Game exceeded ${MAX_STEPS} moves — livelock suspected`);

    const actors = actorsToAct(state);
    if (actors.length === 0) throw new Error('No actor can move but the game is not finished');

    const seat = pick(rng, actors);
    const view = redact(state, seat);
    const move = chooserFor(seat)(view, seat);

    // A chooser only ever sees `view.legalMoves`, so anything else is a bug in
    // the policy — catch it here rather than as a confusing engine throw.
    if (!view.legalMoves.some((m) => moveKey(m) === moveKey(move))) {
      throw new Error(`Seat ${seat} proposed ${moveKey(move)}, which is not among its legal moves`);
    }

    moves.push(move);
    const applied = applyMove(state, move);
    state = applied.state;
    deliver(opts, applied.events, playerCount);
    if (check) assertInvariants(state, `after ${moves.length} moves`);
  }

  return {
    seed: opts.seed,
    config,
    playerIds,
    moves,
    finalHash: hashState(state),
    state,
    steps: moves.length,
  };
}

function deliver(opts: PlayOptions, events: Parameters<typeof redactEvents>[0], players: number): void {
  if (!opts.onEvents || events.length === 0) return;
  for (let seat = 0; seat < players; seat++) opts.onEvents(seat, redactEvents(events, seat));
}

/** Backwards-compatible shorthand used by the invariant test suites. */
export const playRandomGame = (opts: {
  seed: number | string;
  players?: number;
  config?: RuleConfig;
  check?: boolean;
}): GameOutcome => playGame(opts);

export interface BotGameOptions {
  seed: number | string;
  levels: readonly BotLevel[];
  config?: RuleConfig;
  check?: boolean;
}

/** A full game between bots, each wired to its own policy instance and memory. */
export function playBotGame(opts: BotGameOptions): GameOutcome {
  const bots: BotPolicy[] = opts.levels.map((level, seat) =>
    createBot(level, seat, `${String(opts.seed)}:${seat}`),
  );
  return playGame({
    seed: opts.seed,
    players: opts.levels.length,
    ...(opts.config ? { config: opts.config } : {}),
    ...(opts.check !== undefined ? { check: opts.check } : {}),
    choosers: bots.map((bot) => (view: PlayerView) => bot.chooseMove(view)),
    onEvents: (seat, events) => bots[seat]?.observe(events),
  });
}

// --- CLI --------------------------------------------------------------------

interface Args {
  games: number;
  players: number;
  deck: DeckSize;
  seed: number;
  check: boolean;
  levels: BotLevel[] | null;
  matrix: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { games: 1000, players: 2, deck: 36, seed: 1, check: true, levels: null, matrix: false };
  // `pnpm sim -- --games 10` forwards the bare `--` too; drop it.
  const clean = argv.filter((a) => a !== '--');
  for (let i = 0; i < clean.length; i += 2) {
    const key = clean[i];
    const value = clean[i + 1];
    if (key === undefined || value === undefined) break;
    switch (key) {
      case '--games': args.games = Number(value); break;
      case '--players': args.players = Number(value); break;
      case '--deck': args.deck = Number(value) === 52 ? 52 : 36; break;
      case '--seed': args.seed = Number(value); break;
      case '--check': args.check = value !== 'false'; break;
      case '--matrix': args.matrix = value !== 'false'; break;
      case '--bots': {
        const levels = value.split(',').map(Number);
        if (!levels.every(isBotLevel)) throw new Error(`--bots takes levels 1..4, got ${value}`);
        args.levels = levels;
        args.players = levels.length;
        break;
      }
      default: throw new Error(`Unknown flag ${key}`);
    }
  }
  return args;
}

function main(argv: readonly string[]): void {
  const args = parseArgs(argv);
  const config: RuleConfig = { ...DEFAULT_RULES, deckSize: args.deck };
  const started = Date.now();
  let totalSteps = 0;
  let draws = 0;
  const durakBySeat = new Map<number, number>();

  for (let i = 0; i < args.games; i++) {
    const seed = args.seed + i;
    // With bots the table size is fixed by how many were asked for, so keep
    // resampling until the rules can actually deal that many hands.
    const setup = args.matrix
      ? randomSetup(seedRng(`matrix:${seed}`), args.levels?.length)
      : { config, players: args.players };
    try {
      const outcome = args.levels
        ? playBotGame({ seed, levels: args.levels, config: setup.config, check: args.check })
        : playGame({ seed, players: setup.players, config: setup.config, check: args.check });
      totalSteps += outcome.steps;
      const durak = outcome.state.result?.durak;
      if (durak === null || durak === undefined) draws++;
      else {
        const seat = outcome.playerIds.indexOf(durak);
        durakBySeat.set(seat, (durakBySeat.get(seat) ?? 0) + 1);
      }
    } catch (err) {
      console.error(`\nFAILED on seed ${seed}`);
      console.error(JSON.stringify({ seed, players: setup.players, bots: args.levels, config: setup.config }, null, 2));
      console.error(err);
      process.exit(1);
    }
  }

  const ms = Date.now() - started;
  const who = args.matrix
    ? 'random rule matrix'
    : args.levels
      ? `bots ${args.levels.join(' vs ')}`
      : `${args.players}p random`;
  console.log(
    `${args.games} games, ${who}, ${args.deck}-card deck: OK in ${ms} ms ` +
      `(${(args.games / (ms / 1000)).toFixed(0)} games/s, ${(totalSteps / args.games).toFixed(1)} moves/game)`,
  );
  console.log(`draws: ${draws} (${((100 * draws) / args.games).toFixed(1)} %)`);
  for (const [seat, n] of [...durakBySeat].sort((a, b) => a[0] - b[0])) {
    const label = args.levels ? `seat ${seat} (L${args.levels[seat]!})` : `seat ${seat}`;
    console.log(`  durak ${label}: ${n} (${((100 * n) / args.games).toFixed(1)} %)`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
