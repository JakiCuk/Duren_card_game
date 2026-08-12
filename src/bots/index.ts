import type { Seat } from '../engine/index.js';
import { createLevel1 } from './level1.js';
import { createLevel2 } from './level2.js';
import { createLevel3 } from './level3.js';
import { createLevel4 } from './level4.js';
import type { BotFactory, BotLevel, BotPolicy } from './types.js';

export * from './types.js';
export * from './heuristics.js';
export { createLevel1 } from './level1.js';
export { createLevel2 } from './level2.js';
export { createLevel3 } from './level3.js';
export { createLevel4, LEVEL4_TUNING, type Level4Tuning } from './level4.js';
export { Belief, BeliefTable, DECK } from './belief.js';
export { determinize } from './determinize.js';
export { CountingMemory } from './counting.js';
export { solveEndgame } from './endgame.js';
export * from './probability.js';

const FACTORIES: Record<BotLevel, BotFactory | null> = {
  1: createLevel1,
  2: createLevel2,
  3: createLevel3,
  4: createLevel4,
};

/** Highest level implemented so far; requests above it fall back to this. */
export const MAX_BOT_LEVEL: BotLevel = 4;

export interface BotDescription {
  level: BotLevel;
  /** Translation keys, not prose: the catalogue is shared with the server. */
  nameKey: string;
  blurbKey: string;
  available: boolean;
}

export const BOT_CATALOGUE: BotDescription[] = [
  { level: 1, nameKey: 'bots.1.name', blurbKey: 'bots.1.blurb', available: true },
  { level: 2, nameKey: 'bots.2.name', blurbKey: 'bots.2.blurb', available: true },
  { level: 3, nameKey: 'bots.3.name', blurbKey: 'bots.3.blurb', available: true },
  { level: 4, nameKey: 'bots.4.name', blurbKey: 'bots.4.blurb', available: true },
];

export function createBot(level: BotLevel, seat: Seat, seed: number | string): BotPolicy {
  const factory = FACTORIES[level];
  if (factory) return factory(seat, seed);
  // Asking for a level that is not built yet is a configuration problem, not a
  // reason to crash a live game — fall back to the strongest one that exists.
  return FACTORIES[MAX_BOT_LEVEL]!(seat, seed);
}

export const isBotLevel = (n: number): n is BotLevel => n === 1 || n === 2 || n === 3 || n === 4;
