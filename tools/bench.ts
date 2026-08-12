/**
 * Win-rate matrix across the bot ladder.
 *
 * Prints a markdown table of paired-seed duels with Wilson intervals, and exits
 * non-zero if the ladder is not monotone. A "bot improvement" that cannot clear
 * that bar is not an improvement.
 *
 *   pnpm bench -- --games 500
 *   pnpm bench -- --games 2000 --gate 0.55
 */
import { pathToFileURL } from 'node:url';
import { createBot, MAX_BOT_LEVEL, type BotLevel } from '../src/bots/index.js';
import type { BotFactory } from '../src/bots/types.js';
import { DEFAULT_RULES, PRESETS, type RuleConfig } from '../src/shared/rules.js';
import { duel, percent, type DuelResult } from './duel.js';

const make = (level: BotLevel): BotFactory => (seat, seed) => createBot(level, seat, seed);

interface Cell {
  a: BotLevel;
  b: BotLevel;
  result: DuelResult;
  ms: number;
}

function matrix(levels: readonly BotLevel[], games: number, config: RuleConfig): Cell[] {
  const cells: Cell[] = [];
  for (let i = 0; i < levels.length; i++) {
    for (let j = i + 1; j < levels.length; j++) {
      const a = levels[i]!;
      const b = levels[j]!;
      const started = Date.now();
      cells.push({ a, b, result: duel(make(a), make(b), games, config), ms: Date.now() - started });
    }
  }
  return cells;
}

function printMatrix(title: string, cells: Cell[]): void {
  console.log(`\n### ${title}\n`);
  console.log('| matchup | A durak | B durak | draws | A score | 95 % CI | ms |');
  console.log('|---|---:|---:|---:|---:|---|---:|');
  for (const { a, b, result: r, ms } of cells) {
    console.log(
      `| L${a} vs L${b} | ${r.aLosses} | ${r.bLosses} | ${r.draws} | ${percent(r.aScore)} | ` +
        `${percent(r.ci[0])} – ${percent(r.ci[1])} | ${ms} |`,
    );
  }
}

function main(argv: readonly string[]): void {
  const clean = argv.filter((x) => x !== '--');
  const flag = (name: string, fallback: number): number => {
    const i = clean.indexOf(`--${name}`);
    return i === -1 ? fallback : Number(clean[i + 1]);
  };
  const games = flag('games', 600);
  /** Lower bound of the interval that a stronger level must clear. */
  const gate = flag('gate', 0.55);
  const full = clean.includes('--presets');

  const levels = Array.from({ length: MAX_BOT_LEVEL }, (_, i) => (i + 1) as BotLevel);
  const cells = matrix(levels, games, DEFAULT_RULES);
  printMatrix(`Default rules — ${games} paired deals each`, cells);

  if (full) {
    for (const preset of PRESETS.slice(1)) {
      printMatrix(
        `Preset "${preset.id}" — ${Math.round(games / 2)} paired deals each`,
        matrix(levels, Math.round(games / 2), preset.config),
      );
    }
  }

  // Neighbouring levels are the ones that must be ordered: L3 beating L1 is not
  // evidence that L3 beats L2.
  const failures: string[] = [];
  for (const { a, b, result } of cells) {
    if (b !== a - 1 && a !== b - 1) continue;
    const stronger = a > b;
    const score = stronger ? result.aScore : 1 - result.aScore;
    const lower = stronger ? result.ci[0] : 1 - result.ci[1];
    const higher = Math.max(a, b);
    const lowerLevel = Math.min(a, b);
    const width = result.ci[1] - result.ci[0];
    if (lower < gate) {
      // A wide interval means "not enough deals", which is a different problem
      // from "this level is not actually stronger". Saying so saves an hour of
      // chasing a regression that is really just noise.
      const cause =
        width > 0.1
          ? `interval is ${percent(width)} wide — run more deals`
          : `interval starts at ${percent(lower)}, needs ${percent(gate)}`;
      failures.push(`L${higher} vs L${lowerLevel}: ${percent(score)} (${cause})`);
    }
  }

  console.log('');
  if (failures.length > 0) {
    console.error('The strength ladder is not monotone:');
    for (const line of failures) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log(`Ladder holds: every level beats the one below it with the interval above ${percent(gate)}.`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
