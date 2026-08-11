import {
  cardCode,
  compareCards,
  fullDeck,
  parseCardCode,
  suitOf,
  type CardId,
  type GameState,
  type Seat,
  type Suit,
  type TableSlot,
} from '../../src/engine/index.js';
import { seedRng } from '../../src/engine/rng.js';
import { DEFAULT_RULES, type RuleConfig } from '../../src/shared/rules.js';

/** `'6C 7D AS'` → card ids. Empty string → `[]`. */
export function cards(spec: string): CardId[] {
  return spec
    .split(/\s+/)
    .filter((s) => s.length > 0)
    .map(parseCardCode);
}

export const codes = (ids: readonly CardId[]): string => ids.map(cardCode).join(' ');

/** `'S'` → the spades suit. Any rank works as the carrier; only the suit is read. */
const parseSuit = (letter: string): Suit => suitOf(parseCardCode(`2${letter}`));

export interface StateSpec {
  /** One string of card codes per seat, e.g. `['6C 7D', 'AS KH']`. */
  hands: string[];
  /** `[attack, defence | null]` pairs. */
  table?: [string, string | null][];
  /**
   * Draw pile, front first. Its last card is the face-up trump card and
   * therefore fixes the trump suit. Omit for an endgame position.
   */
  deck?: string;
  /** Required only when the deck is empty; otherwise derived from the deck. */
  trump?: string;
  attacker?: Seat;
  defender?: Seat;
  defenderTaking?: boolean;
  defenderHandAtBoutStart?: number;
  passed?: boolean[];
  transfersThisBout?: number;
  boutIndex?: number;
  config?: Partial<RuleConfig>;
}

/**
 * Builds an exact position for scenario tests.
 *
 * Every card of the deck that the spec does not place lands in the discard, so
 * the card-conservation invariant holds without the test having to enumerate
 * 36 cards to describe a three-card situation.
 */
export function makeState(spec: StateSpec): GameState {
  const config: RuleConfig = { ...DEFAULT_RULES, ...spec.config };
  const hands = spec.hands.map((h) => cards(h).sort(compareCards));
  const table: TableSlot[] = (spec.table ?? []).map(([a, d]) => ({
    attack: parseCardCode(a),
    defence: d === null ? null : parseCardCode(d),
  }));
  const deck = cards(spec.deck ?? '');

  const trumpCard = deck.length > 0 ? deck[deck.length - 1]! : null;
  let trump: Suit;
  if (trumpCard !== null) {
    trump = suitOf(trumpCard);
    if (spec.trump !== undefined && parseSuit(spec.trump) !== trump) {
      throw new Error('Declared trump contradicts the bottom card of the deck');
    }
  } else {
    if (spec.trump === undefined) throw new Error('An empty deck needs an explicit trump suit');
    trump = parseSuit(spec.trump);
  }

  const placed = new Set<CardId>();
  const claim = (c: CardId, where: string): void => {
    if (placed.has(c)) throw new Error(`Card ${c} placed twice (${where})`);
    placed.add(c);
  };
  hands.forEach((h, seat) => h.forEach((c) => claim(c, `hand ${seat}`)));
  table.forEach((t) => {
    claim(t.attack, 'table');
    if (t.defence !== null) claim(t.defence, 'table');
  });
  deck.forEach((c) => claim(c, 'deck'));

  const discard = fullDeck(config.deckSize).filter((c) => !placed.has(c));

  const attacker = spec.attacker ?? 0;
  const defender = spec.defender ?? (attacker + 1) % hands.length;

  return {
    config,
    trump,
    trumpCard,
    phase: 'bout',
    step: 0,
    rng: seedRng('test'),
    players: hands.map((hand, seat) => ({ id: `p${seat}`, seat, hand, outAtStep: null })),
    deck,
    discard,
    attacker,
    defender,
    table,
    boutIndex: spec.boutIndex ?? 1,
    defenderTaking: spec.defenderTaking ?? false,
    defenderHandAtBoutStart: spec.defenderHandAtBoutStart ?? hands[defender]!.length,
    passed: spec.passed ?? hands.map(() => false),
    transfersThisBout: spec.transfersThisBout ?? 0,
    boutsWithoutProgress: 0,
    result: null,
  };
}

export const handOf = (s: GameState, seat: Seat): string => codes(s.players[seat]!.hand);
