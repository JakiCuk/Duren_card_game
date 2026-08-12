import type { DeckSize } from '../engine/cards.js';
import { deckSizeOf } from '../engine/cards.js';

/** How many attack cards a bout may hold while the defender is still defending. */
export type AttackCap =
  | { kind: 'fixed'; n: number }
  | { kind: 'defenderHand' }
  | { kind: 'unlimited' };

/** How far the pile may grow once the defender has said "I take". */
export type ThrowInAfterTakeCap = 'sameAsAttack' | 'defenderHandAtBoutStart' | 'unlimited';

/** Who may join the attack: everyone, or only the defender's two neighbours. */
export type AttackerScope = 'all' | 'neighbours';

export interface TransferRules {
  /** Perevodnoy: the defender may pass the attack on instead of beating it. */
  enabled: boolean;
  /** Transfer by *showing* a trump of the matching rank, without playing it. */
  withTrumpReveal: boolean;
  /** May the new defender transfer onward in the same bout? */
  allowChains: boolean;
}

/**
 * House rules for one room. Locked in at game start and copied into the
 * `GameState`, so a mid-game change is impossible by construction.
 *
 * 2v2 teams are the one variant still missing; they arrive with their own
 * slice, because the teammate bans touch every rule below.
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
  attackCap: AttackCap;
  throwInAfterTakeCap: ThrowInAfterTakeCap;
  /** Classic rule: the very first attack of a game is capped at `handSize - 1`. */
  firstBoutCapFive: boolean;
  /** May attackers keep piling on after the defender has said "I take"? */
  throwInAfterTake: boolean;
  attackerScope: AttackerScope;
  transfer: TransferRules;
  firstAttacker: 'lowestTrump' | 'random';
  /**
   * Taking becomes a last resort rather than a choice: legal only when nothing
   * in hand beats the attack. This is not a small switch — see `validateConfig`.
   */
  defenderMustBeatAll: boolean;
  /** Bottom card of the deck turned face up. Hiding it changes the information game. */
  trumpCardVisible: boolean;
}

export const DEFAULT_RULES: RuleConfig = {
  deckSize: 36,
  handSize: 6,
  maxTableSlots: 6,
  attackCap: { kind: 'defenderHand' },
  throwInAfterTakeCap: 'defenderHandAtBoutStart',
  firstBoutCapFive: false,
  throwInAfterTake: true,
  attackerScope: 'all',
  transfer: { enabled: false, withTrumpReveal: false, allowChains: false },
  firstAttacker: 'lowestTrump',
  defenderMustBeatAll: false,
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

/**
 * Rejects configurations that cannot be dealt or cannot terminate, and warns
 * about the combinations that surprise people. Each rule here is a decision,
 * not a guess — the reasoning lives in the comments.
 */
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
  if (config.attackCap.kind === 'fixed' && (config.attackCap.n < 1 || config.attackCap.n > 12)) {
    errors.push({ code: 'attack_cap_out_of_range', params: { n: config.attackCap.n } });
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
  if (available >= needed && available < needed + config.handSize) {
    warnings.push({ code: 'deck_barely_sufficient', params: { deckSize: config.deckSize, players } });
  }

  if (config.firstBoutCapFive && config.handSize < 3) {
    warnings.push({ code: 'first_bout_cap_meaningless', params: { handSize: config.handSize } });
  }

  // "Neighbours only" and "everyone" are the same rule at two and three
  // players — the defender has no non-neighbour to be protected from.
  if (config.attackerScope === 'neighbours' && players <= 3) {
    warnings.push({ code: 'scope_has_no_effect', params: { players } });
  }

  // Sub-options of a switch that is off do nothing. Say so rather than let
  // somebody believe they enabled transfers.
  if (!config.transfer.enabled && (config.transfer.withTrumpReveal || config.transfer.allowChains)) {
    warnings.push({ code: 'transfer_options_without_transfer' });
  }

  // A transfer needs somebody to transfer *to* who is not the current attacker
  // mid-bout; with two players the attack simply bounces back, which is legal
  // but far swingier than people expect.
  if (config.transfer.enabled && players === 2) {
    warnings.push({ code: 'transfer_two_players' });
  }

  if (config.defenderMustBeatAll) {
    // It removes the defender's central decision, and it hands counting bots a
    // certainty: "they took" now proves "they had nothing".
    warnings.push({ code: 'must_beat_all_changes_the_game' });
    if (config.throwInAfterTake && config.throwInAfterTakeCap === 'unlimited') {
      // The defender cannot concede early, so attackers can grind them for the
      // whole hand. Bounded, but unpleasant.
      warnings.push({ code: 'must_beat_all_with_unlimited_pile' });
    }
  }

  return { errors, warnings };
}

export const isPlayable = (config: RuleConfig, players: number): boolean =>
  validateConfig(config, players).errors.length === 0;

/**
 * Ready-made setups for the lobby, so nobody has to understand every switch.
 * Names and descriptions live in the client's dictionaries, keyed by `id`.
 */
export interface RulePreset {
  id: string;
  config: RuleConfig;
}

export const PRESETS: RulePreset[] = [
  {
    id: 'classic',
    config: DEFAULT_RULES,
  },
  {
    id: 'perevodnoy',
    config: {
      ...DEFAULT_RULES,
      transfer: { enabled: true, withTrumpReveal: false, allowChains: true },
    },
  },
  {
    id: 'strict',
    config: { ...DEFAULT_RULES, defenderMustBeatAll: true, firstBoutCapFive: true },
  },
  {
    id: 'big',
    config: { ...DEFAULT_RULES, deckSize: 52, attackerScope: 'neighbours' },
  },
];
