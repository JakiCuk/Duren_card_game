import type { DeckSize } from '../engine/cards.js';
import { deckSizeOf } from '../engine/cards.js';

/**
 * House rules for one room. Locked in at game start and copied into the
 * `GameState`, so a mid-game change is impossible by construction.
 *
 * This type carries only the switches the engine actually honours today. The
 * remaining variants from the design (perevodnoy transfer, attacker scope,
 * fixed attack caps, `defenderMustBeatAll`, 2v2 teams) arrive with their tests
 * in a later slice — a flag that exists but is ignored is worse than no flag.
 */
export interface RuleConfig {
  deckSize: DeckSize;
  /** Cards dealt to each player, and the count they refill to. */
  handSize: number;
  /**
   * Hard ceiling on attack cards per bout, independent of hand sizes. Even
   * under "unlimited" house rules this must exist: without it a griefer or a
   * buggy bot can build a 30-card table and the UI, the animations and the
   * bot search all degrade.
   */
  maxTableSlots: number;
  /** Classic rule: the very first attack of a game is capped at `handSize - 1`. */
  firstBoutCapFive: boolean;
  /** May attackers keep piling on after the defender has said "I take"? */
  throwInAfterTake: boolean;
  firstAttacker: 'lowestTrump' | 'random';
  /** Bottom card of the deck turned face up. Hiding it changes the information game. */
  trumpCardVisible: boolean;
}

export const DEFAULT_RULES: RuleConfig = {
  deckSize: 36,
  handSize: 6,
  maxTableSlots: 6,
  firstBoutCapFive: false,
  throwInAfterTake: true,
  firstAttacker: 'lowestTrump',
  trumpCardVisible: true,
};

export interface ConfigProblem {
  code: string;
  /** Values the UI needs to render a localized message. */
  params?: Record<string, number | string>;
}

export interface ConfigVerdict {
  errors: ConfigProblem[];
  warnings: ConfigProblem[];
}

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export function validateConfig(config: RuleConfig, players: number): ConfigVerdict {
  const errors: ConfigProblem[] = [];
  const warnings: ConfigProblem[] = [];

  if (players < MIN_PLAYERS || players > MAX_PLAYERS) {
    errors.push({ code: 'players_out_of_range', params: { min: MIN_PLAYERS, max: MAX_PLAYERS, players } });
  }
  if (config.handSize < 2 || config.handSize > 8) {
    errors.push({ code: 'hand_size_out_of_range', params: { handSize: config.handSize } });
  }
  if (config.maxTableSlots < 1 || config.maxTableSlots > 12) {
    errors.push({ code: 'max_table_slots_out_of_range', params: { maxTableSlots: config.maxTableSlots } });
  }

  // The deal must leave at least the trump card behind, otherwise there is no
  // bottom card to turn up and no trump suit. 36 cards therefore caps at
  // 5 players with a 6-card hand; 6 players requires a 52-card deck.
  const needed = players * config.handSize + 1;
  const available = deckSizeOf(config.deckSize);
  if (available < needed) {
    errors.push({
      code: 'deck_too_small',
      params: { deckSize: config.deckSize, players, handSize: config.handSize, needed },
    });
  }

  // Not wrong, but the endgame arrives almost immediately and the game becomes
  // mostly a deal rather than a contest.
  if (available >= needed && available < needed + config.handSize) {
    warnings.push({ code: 'deck_barely_sufficient', params: { deckSize: config.deckSize, players } });
  }

  if (config.firstBoutCapFive && config.handSize < 3) {
    warnings.push({ code: 'first_bout_cap_meaningless', params: { handSize: config.handSize } });
  }

  return { errors, warnings };
}

export const isPlayable = (config: RuleConfig, players: number): boolean =>
  validateConfig(config, players).errors.length === 0;
