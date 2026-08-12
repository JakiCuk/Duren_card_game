import type { RuleConfig } from '../shared/rules.js';
import type { CardId, Suit } from './cards.js';
import { compareCards } from './cards.js';
import { seedRng } from './rng.js';
import type { GameState, PlayerId, Seat, TableSlot } from './state.js';

export interface StateSpec {
  config: RuleConfig;
  trump: Suit;
  trumpCard?: CardId | null;
  /** One hand per seat, in seat order. */
  hands: readonly (readonly CardId[])[];
  deck?: readonly CardId[];
  discard?: readonly CardId[];
  table?: readonly TableSlot[];
  attacker: Seat;
  defender: Seat;
  defenderTaking?: boolean;
  defenderHandAtBoutStart?: number;
  passed?: readonly boolean[];
  transfersThisBout?: number;
  boutsWithoutProgress?: number;
  boutIndex?: number;
  step?: number;
  outAtStep?: readonly (number | null)[];
  playerIds?: readonly PlayerId[];
  seed?: number | string;
}

/**
 * Builds a `GameState` directly, without dealing.
 *
 * Two callers need this and neither is cheating: tests describing an exact
 * position, and a bot reasoning about a hypothetical one it deduced from public
 * information. Keeping it in the engine means both get a state the rules
 * actually accept, rather than two hand-rolled approximations.
 */
export function assembleState(spec: StateSpec): GameState {
  const hands = spec.hands.map((h) => [...h].sort(compareCards));
  const deck = [...(spec.deck ?? [])];
  const defenderHand = hands[spec.defender] ?? [];

  return {
    config: spec.config,
    trump: spec.trump,
    trumpCard: spec.trumpCard ?? (deck.length > 0 ? (deck[deck.length - 1] ?? null) : null),
    phase: 'bout',
    step: spec.step ?? 0,
    rng: seedRng(spec.seed ?? 'assembled'),
    players: hands.map((hand, seat) => ({
      id: spec.playerIds?.[seat] ?? `s${seat}`,
      seat,
      hand,
      outAtStep: spec.outAtStep?.[seat] ?? null,
    })),
    deck,
    discard: [...(spec.discard ?? [])],
    attacker: spec.attacker,
    defender: spec.defender,
    table: (spec.table ?? []).map((t) => ({ attack: t.attack, defence: t.defence })),
    boutIndex: spec.boutIndex ?? 1,
    defenderTaking: spec.defenderTaking ?? false,
    defenderHandAtBoutStart: spec.defenderHandAtBoutStart ?? defenderHand.length,
    passed: spec.passed ? [...spec.passed] : hands.map(() => false),
    transfersThisBout: spec.transfersThisBout ?? 0,
    boutsWithoutProgress: spec.boutsWithoutProgress ?? 0,
    result: null,
  };
}
