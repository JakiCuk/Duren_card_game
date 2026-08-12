import type { Seat } from '../engine/index.js';
import { createLevel1 } from './level1.js';
import { createLevel2 } from './level2.js';
import type { BotFactory, BotLevel, BotPolicy } from './types.js';

export * from './types.js';
export * from './heuristics.js';
export { createLevel1 } from './level1.js';
export { createLevel2 } from './level2.js';

const FACTORIES: Record<BotLevel, BotFactory | null> = {
  1: createLevel1,
  2: createLevel2,
  3: null, // card counting — later slice
  4: null, // opponent modelling and bluffing — later slice
};

/** Highest level implemented so far; requests above it fall back to this. */
export const MAX_BOT_LEVEL: BotLevel = 2;

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
  { level: 3, nameKey: 'bots.3.name', blurbKey: 'bots.3.blurb', available: false },
  { level: 4, nameKey: 'bots.4.name', blurbKey: 'bots.4.blurb', available: false },
];

export function createBot(level: BotLevel, seat: Seat, seed: number | string): BotPolicy {
  const factory = FACTORIES[level];
  if (factory) return factory(seat, seed);
  // Asking for a level that is not built yet is a configuration problem, not a
  // reason to crash a live game — fall back to the strongest one that exists.
  return FACTORIES[MAX_BOT_LEVEL]!(seat, seed);
}

export const isBotLevel = (n: number): n is BotLevel => n === 1 || n === 2 || n === 3 || n === 4;
