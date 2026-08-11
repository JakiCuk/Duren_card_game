/**
 * Head-to-head between two bot policies over paired seeds.
 *
 * Every deal is played twice with the seats swapped, so the luck of the deal
 * cancels out and the remaining difference is the policies. Without that, a few
 * hundred games say almost nothing.
 *
 *   pnpm duel -- --a 2 --b 1 --games 500
 */
import { pathToFileURL } from 'node:url';
import { createBot, isBotLevel, type BotLevel } from '../src/bots/index.js';
import type { BotFactory } from '../src/bots/types.js';
import type { PlayerView } from '../src/engine/index.js';
import { DEFAULT_RULES, type RuleConfig } from '../src/shared/rules.js';
import { playGame } from './sim.js';

export interface DuelResult {
  games: number;
  aLosses: number;
  bLosses: number;
  draws: number;
  /** Share of decided games in which A was *not* the durak. 50 % is parity. */
  aScore: number;
  /** Wilson 95 % interval around `aScore`, so small samples cannot mislead. */
  ci: [number, number];
}

export function duel(
  a: BotFactory,
  b: BotFactory,
  games: number,
  config: RuleConfig = DEFAULT_RULES,
): DuelResult {
  let aLosses = 0;
  let bLosses = 0;
  let draws = 0;

  for (let i = 0; i < games; i++) {
    for (const swapped of [false, true]) {
      const factories = swapped ? [b, a] : [a, b];
      const bots = factories.map((make, seat) => make(seat, `${i}:${seat}`));
      const out = playGame({
        seed: i,
        players: 2,
        config,
        check: false,
        choosers: bots.map((bot) => (v: PlayerView) => bot.chooseMove(v)),
        onEvents: (seat, events) => bots[seat]?.observe(events),
      });

      const durak = out.state.result?.durak ?? null;
      if (durak === null) {
        draws++;
        continue;
      }
      const seat = out.playerIds.indexOf(durak);
      const aWasDurak = swapped ? seat === 1 : seat === 0;
      if (aWasDurak) aLosses++;
      else bLosses++;
    }
  }

  const decided = aLosses + bLosses;
  const aScore = decided === 0 ? 0.5 : bLosses / decided;
  return { games: games * 2, aLosses, bLosses, draws, aScore, ci: wilson(bLosses, decided) };
}

/** Wilson score interval — behaves sanely near 0 and 1, unlike the normal one. */
export function wilson(successes: number, trials: number, z = 1.96): [number, number] {
  if (trials === 0) return [0, 1];
  const p = successes / trials;
  const denom = 1 + (z * z) / trials;
  const centre = p + (z * z) / (2 * trials);
  const spread = z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials));
  return [(centre - spread) / denom, (centre + spread) / denom];
}

export const percent = (x: number): string => `${(100 * x).toFixed(1)} %`;

function main(argv: readonly string[]): void {
  const clean = argv.filter((x) => x !== '--');
  const flag = (name: string, fallback: number): number => {
    const i = clean.indexOf(`--${name}`);
    return i === -1 ? fallback : Number(clean[i + 1]);
  };
  const levelA = flag('a', 2);
  const levelB = flag('b', 1);
  const games = flag('games', 500);
  const deck = flag('deck', 36) === 52 ? 52 : 36;
  if (!isBotLevel(levelA) || !isBotLevel(levelB)) throw new Error('--a and --b take levels 1..4');

  const make = (level: BotLevel): BotFactory => (seat, seed) => createBot(level, seat, seed);
  const started = Date.now();
  const r = duel(make(levelA), make(levelB), games, { ...DEFAULT_RULES, deckSize: deck });

  console.log(`L${levelA} vs L${levelB} — ${r.games} games (${games} paired deals), ${deck}-card deck`);
  console.log(`  L${levelA} is the durak: ${r.aLosses}`);
  console.log(`  L${levelB} is the durak: ${r.bLosses}`);
  console.log(`  draws: ${r.draws} (${percent(r.draws / r.games)})`);
  console.log(
    `  L${levelA} score: ${percent(r.aScore)}  [${percent(r.ci[0])} .. ${percent(r.ci[1])}]  ` +
      `in ${Date.now() - started} ms`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
