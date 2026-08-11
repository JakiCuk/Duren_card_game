import { rankOf, suitOf, type CardId, type Move, type PlayerView, type Suit } from '../engine/index.js';

export const isTrump = (c: CardId, trump: Suit): boolean => suitOf(c) === trump;

/**
 * Rough exchange value of a card, in "ranks".
 *
 * The trump premium is what makes the rest of the heuristics work: a six of
 * trumps is worth more than an ace of anything else, and a bot that does not
 * price that in will cheerfully burn its winners on nothing.
 */
export function cardValue(c: CardId, trump: Suit): number {
  const r = rankOf(c);
  return isTrump(c, trump) ? 14 + r * 1.5 : r;
}

export type Phase = 'early' | 'mid' | 'endgame';

export function phaseOf(view: PlayerView): Phase {
  if (view.deckCount === 0) return 'endgame';
  return view.deckCount > view.config.handSize * 2 ? 'early' : 'mid';
}

export const attackMoves = (view: PlayerView): Extract<Move, { t: 'ATTACK' }>[] =>
  view.legalMoves.filter((m): m is Extract<Move, { t: 'ATTACK' }> => m.t === 'ATTACK');

export const defendMoves = (view: PlayerView): Extract<Move, { t: 'DEFEND' }>[] =>
  view.legalMoves.filter((m): m is Extract<Move, { t: 'DEFEND' }> => m.t === 'DEFEND');

export const transferMoves = (view: PlayerView): Extract<Move, { t: 'TRANSFER' }>[] =>
  view.legalMoves.filter((m): m is Extract<Move, { t: 'TRANSFER' }> => m.t === 'TRANSFER');

export const takeMove = (view: PlayerView): Move | undefined =>
  view.legalMoves.find((m) => m.t === 'TAKE');

export const passMove = (view: PlayerView): Move | undefined =>
  view.legalMoves.find((m) => m.t === 'PASS');

/** Lowest `score` wins; ties break on card id, so the choice is deterministic. */
export function pickCheapest<T extends { card: CardId }>(
  moves: readonly T[],
  score: (card: CardId) => number,
): T | undefined {
  let best: T | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const m of moves) {
    const s = score(m.card);
    if (s < bestScore || (s === bestScore && best !== undefined && m.card < best.card)) {
      best = m;
      bestScore = s;
    }
  }
  return best;
}

/** Indices of table slots still waiting for a defence, lowest first. */
export const unbeatenSlots = (view: PlayerView): number[] =>
  view.table.flatMap((slot, i) => (slot.defence === null ? [i] : []));

/** How many cards of each rank we hold — a rank we hold twice is a safe attack. */
export function rankCounts(hand: readonly CardId[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const c of hand) counts.set(rankOf(c), (counts.get(rankOf(c)) ?? 0) + 1);
  return counts;
}

export const myHand = (view: PlayerView): readonly CardId[] => view.you?.hand ?? [];

export const opponents = (view: PlayerView): PlayerView['players'] =>
  view.players.filter((p) => p.seat !== view.you?.seat && !p.out);
