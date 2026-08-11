/**
 * Headless random-game driver.
 *
 * Its purpose is not to play well but to visit strange states fast: it walks
 * uniformly random legal moves and asserts every engine invariant after each
 * one. Any violation prints a `{config, seed, moves}` blob that drops straight
 * into a regression test.
 *
 * Run: `pnpm sim -- --games 10000 --players 2`
 */
import { pathToFileURL } from 'node:url';
import {
  actorsToAct,
  applyMove,
  assertInvariants,
  createGame,
  ctxOf,
  hashState,
  legalMoves,
  type DeckSize,
  type GameState,
  type Move,
  type PlayerId,
} from '../src/engine/index.js';
import { nextInt, seedRng, type RngState } from '../src/engine/rng.js';
import { DEFAULT_RULES, type RuleConfig } from '../src/shared/rules.js';

/** Guards against livelocks: no legal Durak game comes anywhere near this. */
export const MAX_STEPS = 2000;

export interface RandomGameOptions {
  seed: number | string;
  players?: number;
  config?: RuleConfig;
  /** Assert invariants after every move. Off makes the driver ~3x faster. */
  check?: boolean;
}

export interface RandomGameOutcome {
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

export function playRandomGame(opts: RandomGameOptions): RandomGameOutcome {
  const playerCount = opts.players ?? 2;
  const config = opts.config ?? DEFAULT_RULES;
  const check = opts.check ?? true;
  const playerIds: PlayerId[] = Array.from({ length: playerCount }, (_, i) => `p${i}`);

  // The driver's randomness is seeded separately from the game's, so shuffling
  // the deck and choosing moves never perturb one another.
  const rng = seedRng(`driver:${String(opts.seed)}`);

  let { state } = createGame({ players: playerIds, config, seed: opts.seed });
  if (check) assertInvariants(state, 'after deal');

  const moves: Move[] = [];
  while (state.phase === 'bout') {
    if (moves.length >= MAX_STEPS) {
      throw new Error(`Game exceeded ${MAX_STEPS} moves — livelock suspected`);
    }
    const actors = actorsToAct(state);
    if (actors.length === 0) throw new Error('No actor can move but the game is not finished');

    const seat = pick(rng, actors);
    const options = legalMoves(ctxOf(state), seat);
    const move = pick(rng, options);

    moves.push(move);
    state = applyMove(state, move).state;
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

interface Args {
  games: number;
  players: number;
  deck: DeckSize;
  seed: number;
  check: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { games: 1000, players: 2, deck: 36, seed: 1, check: true };
  // `pnpm sim -- --games 10` forwards the bare `--` too; drop it.
  argv = argv.filter((a) => a !== '--');
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === undefined || value === undefined) break;
    switch (key) {
      case '--games': args.games = Number(value); break;
      case '--players': args.players = Number(value); break;
      case '--deck': args.deck = Number(value) === 52 ? 52 : 36; break;
      case '--seed': args.seed = Number(value); break;
      case '--check': args.check = value !== 'false'; break;
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
  const durakCounts = new Map<string, number>();

  for (let i = 0; i < args.games; i++) {
    const seed = args.seed + i;
    try {
      const outcome = playRandomGame({ seed, players: args.players, config, check: args.check });
      totalSteps += outcome.steps;
      const durak = outcome.state.result?.durak;
      if (durak === null || durak === undefined) draws++;
      else durakCounts.set(durak, (durakCounts.get(durak) ?? 0) + 1);
    } catch (err) {
      console.error(`\nFAILED on seed ${seed}`);
      console.error(JSON.stringify({ seed, players: args.players, config }, null, 2));
      console.error(err);
      process.exit(1);
    }
  }

  const ms = Date.now() - started;
  console.log(
    `${args.games} games, ${args.players}p, ${args.deck}-card deck: OK in ${ms} ms ` +
      `(${(args.games / (ms / 1000)).toFixed(0)} games/s, ${(totalSteps / args.games).toFixed(1)} moves/game)`,
  );
  console.log(`draws: ${draws}`);
  for (const [id, n] of [...durakCounts].sort()) {
    console.log(`  durak ${id}: ${n} (${((100 * n) / args.games).toFixed(1)} %)`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
