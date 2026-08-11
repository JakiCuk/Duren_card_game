import type { CardId } from './cards.js';
import type { Seat } from './state.js';

/**
 * Four action types, not five.
 *
 * **A throw-in is an `ATTACK`.** Its legality differs by exactly one clause
 * ("the rank must already be on the table") and the actor set is identical, so
 * splitting them would duplicate the cap arithmetic — which is precisely where
 * the classic Durak implementation bugs live. The event log carries a
 * `throwIn` flag for the UI, which is the only place the distinction matters.
 *
 * `DEFEND` carries an explicit `slot`: with two unbeaten attacks of the same
 * rank on the table the move would otherwise be ambiguous, and replays would
 * stop being deterministic.
 *
 * `TRANSFER` (perevodnoy) arrives with the full rule matrix in a later slice.
 */
export type Move =
  | { t: 'ATTACK'; seat: Seat; card: CardId }
  | { t: 'DEFEND'; seat: Seat; card: CardId; slot: number }
  /**
   * Perevodnoy: pass the attack to the next player with a card of the same
   * rank. With `reveal` the card is only *shown* — it stays in hand and the
   * table does not grow, which is why the two need separate cap arithmetic.
   */
  | { t: 'TRANSFER'; seat: Seat; card: CardId; reveal: boolean }
  | { t: 'TAKE'; seat: Seat }
  | { t: 'PASS'; seat: Seat };

export type MoveType = Move['t'];

/** Stable identity of a move, for de-duplication and for readable diffs in tests. */
export function moveKey(m: Move): string {
  switch (m.t) {
    case 'ATTACK':
      return `A${m.seat}:${m.card}`;
    case 'DEFEND':
      return `D${m.seat}:${m.card}@${m.slot}`;
    case 'TRANSFER':
      return `X${m.seat}:${m.card}${m.reveal ? 'r' : ''}`;
    case 'TAKE':
      return `T${m.seat}`;
    case 'PASS':
      return `P${m.seat}`;
  }
}

export const sameMove = (a: Move, b: Move): boolean => moveKey(a) === moveKey(b);
