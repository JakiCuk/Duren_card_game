/**
 * Cards are small integers, not objects: `id = rank * 4 + suit`.
 *
 * The level-3 and level-4 bots simulate millions of states, and an object per
 * card would dominate their cost. It also makes a hand comparable, sortable and
 * hashable for free.
 */

export type Suit = 0 | 1 | 2 | 3;

/** 0..12 == 2,3,…,K,A. A 36-card deck is simply the subset 4..12 (6..A). */
export type Rank = number;

export type CardId = number;

export const CLUBS: Suit = 0;
export const DIAMONDS: Suit = 1;
export const HEARTS: Suit = 2;
export const SPADES: Suit = 3;

export const SUITS: readonly Suit[] = [CLUBS, DIAMONDS, HEARTS, SPADES];

export const RANK_2 = 0;
export const RANK_6 = 4;
export const RANK_10 = 8;
export const RANK_JACK = 9;
export const RANK_QUEEN = 10;
export const RANK_KING = 11;
export const RANK_ACE = 12;

export type DeckSize = 36 | 52;

export const suitOf = (c: CardId): Suit => (c & 3) as Suit;
export const rankOf = (c: CardId): Rank => c >> 2;
export const makeCard = (rank: Rank, suit: Suit): CardId => (rank << 2) | suit;

/** Lowest rank present in a deck of the given size. */
export const lowestRank = (size: DeckSize): Rank => (size === 36 ? RANK_6 : RANK_2);

/** Ordered, unshuffled. */
export function fullDeck(size: DeckSize): CardId[] {
  const out: CardId[] = [];
  for (let r = lowestRank(size); r <= RANK_ACE; r++) {
    for (const s of SUITS) out.push(makeCard(r, s));
  }
  return out;
}

export const deckSizeOf = (size: DeckSize): number => (RANK_ACE - lowestRank(size) + 1) * 4;

/**
 * The core rule primitive, and the only place suit/rank comparison is allowed
 * to live. A trump beats any plain card; nothing beats a trump but a higher one.
 */
export function beats(defence: CardId, attack: CardId, trump: Suit): boolean {
  const ds = suitOf(defence);
  const as = suitOf(attack);
  return ds === as ? rankOf(defence) > rankOf(attack) : ds === trump;
}

const RANK_LABELS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUIT_LABELS = ['C', 'D', 'H', 'S'] as const;

/** Two-character code, e.g. `AS`, `TH`, `6C`. Also the card asset filename. */
export function cardCode(c: CardId): string {
  const r = RANK_LABELS[rankOf(c)];
  const s = SUIT_LABELS[suitOf(c)];
  if (r === undefined || s === undefined) throw new RangeError(`Not a card id: ${c}`);
  return r + s;
}

/** Inverse of {@link cardCode}; used by tests and recorded-game fixtures. */
export function parseCardCode(code: string): CardId {
  const rank = RANK_LABELS.indexOf(code[0]?.toUpperCase() as (typeof RANK_LABELS)[number]);
  const suit = SUIT_LABELS.indexOf(code[1]?.toUpperCase() as (typeof SUIT_LABELS)[number]);
  if (code.length !== 2 || rank < 0 || suit < 0) throw new RangeError(`Not a card code: ${code}`);
  return makeCard(rank, suit as Suit);
}

/**
 * Canonical hand order: ascending card id, i.e. by rank then suit. Deliberately
 * not trump-aware — hands are kept in this order so two states holding the same
 * cards serialize identically, which is what makes `hashState` a usable
 * regression signal. Display order is a client concern.
 */
export function compareCards(a: CardId, b: CardId): number {
  return a - b;
}
