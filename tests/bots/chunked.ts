import { duel, wilson, type DuelResult } from '../../tools/duel.js';
import type { BotFactory } from '../../src/bots/types.js';
import type { RuleConfig } from '../../src/shared/rules.js';

/**
 * Runs a duel as a series of short ones, pausing between them.
 *
 * A few hundred games of level 4 against level 3 is a minute of solid
 * arithmetic, and a synchronous minute inside one `it()` blocks the worker's
 * event loop for the whole of it. Vitest cannot get a progress update through
 * and fails the run with `Timeout calling "onTaskUpdate"` — every test passing,
 * the suite red. Local machines hide it behind spare cores; a two-core CI
 * runner does not.
 *
 * The games themselves are untouched: same seeds, same pairings, same count.
 * The chunks are simply added back together, which is exact — a Wilson interval
 * is a function of two counts, not of how they were gathered.
 *
 * Five deals a chunk, not fifty: birpc gives up after sixty seconds, and the
 * measure is wall time on a machine running several test files at once, where
 * eight seconds of arithmetic can take four times that.
 */
export async function duelInChunks(
  a: BotFactory,
  b: BotFactory,
  games: number,
  config?: RuleConfig,
  chunk = 5,
): Promise<DuelResult> {
  let aLosses = 0;
  let bLosses = 0;
  let draws = 0;

  for (let from = 0; from < games; from += chunk) {
    const part = duel(a, b, Math.min(chunk, games - from), config, from);
    aLosses += part.aLosses;
    bLosses += part.bLosses;
    draws += part.draws;
    // A macrotask, not a microtask: only this lets the reporter's message out.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const decided = aLosses + bLosses;
  return {
    games: games * 2,
    aLosses,
    bLosses,
    draws,
    aScore: decided === 0 ? 0.5 : bLosses / decided,
    ci: wilson(bLosses, decided),
  };
}
