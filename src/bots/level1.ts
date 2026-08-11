import { rankOf, type CardId, type Move, type PlayerView, type Seat } from '../engine/index.js';
import {
  attackMoves,
  defendMoves,
  isTrump,
  passMove,
  pickCheapest,
  takeMove,
  transferMoves,
  unbeatenSlots,
} from './heuristics.js';
import { NoLegalMoveError, type BotPolicy } from './types.js';

/**
 * Level 1 — purely reactive, no model of anything.
 *
 * Plays the cheapest card that is legal, hoards trumps, and takes whenever it
 * cannot beat something cheaply. It exists to be the floor of the strength
 * ladder and a fast driver for the fuzzer, not to be a worthy opponent.
 */
export function createLevel1(seat: Seat, _seed: number | string): BotPolicy {
  return {
    level: 1,
    seat,
    observe() {
      // Level 1 remembers nothing at all. That is the whole idea.
    },
    chooseMove(view: PlayerView): Move {
      if (view.legalMoves.length === 0) throw new NoLegalMoveError(seat);
      const trump = view.trump;
      const plainFirst = (c: CardId): number => (isTrump(c, trump) ? 100 : 0) + rankOf(c);

      // Passing the whole attack on costs one plain card and solves the bout,
      // so it beats defending it — but never at the price of a trump.
      const plainTransfers = transferMoves(view).filter((m) => !isTrump(m.card, trump));
      const handOff = pickCheapest(plainTransfers, plainFirst);
      if (handOff) return handOff;

      // Defending: cover the oldest open slot with the cheapest card that does
      // the job; if nothing does, take.
      const defends = defendMoves(view);
      if (defends.length > 0 || takeMove(view)) {
        const slot = unbeatenSlots(view)[0];
        const forSlot = defends.filter((m) => m.slot === slot);
        const cheapest = pickCheapest(forSlot, plainFirst);
        if (cheapest) return cheapest;
        const take = takeMove(view);
        if (take) return take;
      }

      const attacks = attackMoves(view);
      if (attacks.length > 0) {
        const opening = view.table.length === 0;
        // Opening an attack is compulsory, so a hand of nothing but trumps must
        // still lead one. Throwing in is optional, so it never spends a trump.
        const candidates = opening ? attacks : attacks.filter((m) => !isTrump(m.card, trump));
        const choice = pickCheapest(candidates, plainFirst);
        if (choice) return choice;
      }

      const pass = passMove(view);
      if (pass) return pass;

      // Only reachable if an opening attack was somehow filtered away.
      return view.legalMoves[0]!;
    },
  };
}
