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
  name: string;
  blurb: string;
  available: boolean;
}

export const BOT_CATALOGUE: BotDescription[] = [
  {
    level: 1,
    name: 'Začiatočník',
    blurb: 'Hrá najlacnejšiu možnú kartu a šetrí tromfy. Nepamätá si nič.',
    available: true,
  },
  {
    level: 2,
    name: 'Pokročilý',
    blurb: 'Sleduje fázu hry, hospodári s tromfami a váži, či sa oplatí brať.',
    available: true,
  },
  {
    level: 3,
    name: 'Počtár',
    blurb: 'Počíta odhodené karty a odhaduje, čo môže súper zbiť.',
    available: false,
  },
  {
    level: 4,
    name: 'Majster',
    blurb: 'Modeluje súperovu ruku a cielene blafuje.',
    available: false,
  },
];

export function createBot(level: BotLevel, seat: Seat, seed: number | string): BotPolicy {
  const factory = FACTORIES[level];
  if (factory) return factory(seat, seed);
  // Asking for a level that is not built yet is a configuration problem, not a
  // reason to crash a live game — fall back to the strongest one that exists.
  return FACTORIES[MAX_BOT_LEVEL]!(seat, seed);
}

export const isBotLevel = (n: number): n is BotLevel => n === 1 || n === 2 || n === 3 || n === 4;
