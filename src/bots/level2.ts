import { rankOf, type CardId, type Move, type PlayerView, type Seat } from '../engine/index.js';
import {
  attackMoves,
  cardValue,
  defendMoves,
  isTrump,
  myHand,
  passMove,
  phaseOf,
  pickCheapest,
  rankCounts,
  takeMove,
  unbeatenSlots,
  type Phase,
} from './heuristics.js';
import { NoLegalMoveError, type BotFactory, type BotPolicy } from './types.js';

export interface Level2Tuning {
  /**
   * How much a defence may overpay the attack before taking looks better.
   *
   * Measured, not guessed: taking eagerly is a disaster (it drops the win rate
   * against level 1 from 58 % to 34 %), because absorbed cards never leave
   * again. In the endgame taking is close to losing outright, hence the
   * effectively infinite tolerance there.
   */
  overpaySlack: Record<Phase, number>;
  /** Each card the pile would add raises the tolerance for overpaying. */
  absorbPenalty: number;
  /**
   * Highest plain rank worth throwing in, by phase. This is the single biggest
   * lever in the whole policy — restricting throw-ins to low cards costs about
   * 30 points of win rate, because every card thrown in early is a bad card
   * traded for a fresh one from the deck.
   */
  throwInMax: Record<Phase, number>;
  /** Once the defender has conceded the bout, junk leaves the hand for free. */
  throwInMaxWhenTaking: Record<Phase, number>;
  /**
   * Shed trumps too once the deck is gone. Worth about 8 points: in the endgame
   * the only thing that matters is emptying your hand, and a trump kept is a
   * card not shed.
   */
  throwInTrumpsInEndgame: boolean;
  /** Bonus for opening with a rank we hold more than once, so a throw-in follows. */
  pairBonus: number;
}

/**
 * Tuned against level 1 over paired seeds (see `tools/duel.ts`). Every constant
 * here was measured; the ones that turned out not to matter were deleted rather
 * than left in place looking meaningful.
 */
export const LEVEL2_TUNING: Level2Tuning = {
  overpaySlack: { early: 15, mid: 20, endgame: 1e9 },
  absorbPenalty: 4,
  throwInMax: { early: 12, mid: 12, endgame: 12 },
  throwInMaxWhenTaking: { early: 12, mid: 12, endgame: 12 },
  throwInTrumpsInEndgame: true,
  pairBonus: 3,
};

/**
 * Level 2 — heuristics with hand management.
 *
 * Understands trump economy, the phase of the game, and the difference between
 * spending a card and swallowing one. It also refuses to defend a bout it
 * cannot win, which level 1 happily wastes cards on. No counting and no
 * opponent model: those are levels 3 and 4.
 */
export function createLevel2(seat: Seat, seed: number | string): BotPolicy {
  return createLevel2Tuned(LEVEL2_TUNING)(seat, seed);
}

/** The same policy with different constants — this is what the tuning sweep drives. */
export function createLevel2Tuned(tuning: Level2Tuning): BotFactory {
  return (seat: Seat, _seed: number | string): BotPolicy => ({
    level: 2,
    seat,
    observe() {
      // No memory yet; level 3 is where remembering starts to pay.
    },
    chooseMove(view: PlayerView): Move {
      if (view.legalMoves.length === 0) throw new NoLegalMoveError(seat);
      return decideDefence(view, tuning) ?? decideAttack(view, tuning) ?? passMove(view) ?? view.legalMoves[0]!;
    },
  });
}

function decideDefence(view: PlayerView, tuning: Level2Tuning): Move | undefined {
  const defends = defendMoves(view);
  const take = takeMove(view);
  if (defends.length === 0 && take === undefined) return undefined;

  const trump = view.trump;
  const open = unbeatenSlots(view);

  const cheapestPerSlot = open.map((slot) =>
    pickCheapest(
      defends.filter((m) => m.slot === slot),
      (c) => cardValue(c, trump),
    ),
  );

  // One unanswerable slot decides the bout on its own. Covering the others
  // first would spend cards for nothing — level 1's characteristic mistake.
  if (cheapestPerSlot.some((m) => m === undefined)) return take;

  const covers = cheapestPerSlot.filter((m) => m !== undefined);
  const spend = covers.reduce((sum, m) => sum + cardValue(m.card, trump), 0);
  const worth = open.reduce((sum, slot) => sum + cardValue(view.table[slot]!.attack, trump), 0);

  // The bigger the pile, the worse taking gets — so tolerate more overpayment
  // rather than swallow it.
  const absorbed = view.table.reduce((n, s) => n + (s.defence === null ? 1 : 2), 0);
  const slack = tuning.overpaySlack[phaseOf(view)] + absorbed * tuning.absorbPenalty;
  if (take !== undefined && spend - worth > slack) return take;

  return covers[0] ?? take;
}

function decideAttack(view: PlayerView, tuning: Level2Tuning): Move | undefined {
  const attacks = attackMoves(view);
  if (attacks.length === 0) return undefined;

  const trump = view.trump;
  const phase = phaseOf(view);

  if (view.table.length === 0) {
    // Opening is compulsory: spend the cheapest plain card, preferring a rank
    // we hold twice so a throw-in is guaranteed to follow. A hand of nothing
    // but trumps has to lead one anyway.
    const counts = rankCounts(myHand(view));
    const plain = attacks.filter((m) => !isTrump(m.card, trump));
    const pool = plain.length > 0 ? plain : attacks;
    return pickCheapest(
      pool,
      (c) => cardValue(c, trump) - ((counts.get(rankOf(c)) ?? 0) > 1 ? tuning.pairBonus : 0),
    );
  }

  const limit = view.defenderTaking ? tuning.throwInMaxWhenTaking[phase] : tuning.throwInMax[phase];
  const worthThrowing = attacks.filter((m) =>
    isTrump(m.card, trump)
      ? phase === 'endgame' && tuning.throwInTrumpsInEndgame
      : rankOf(m.card) <= limit,
  );

  return pickCheapest(worthThrowing, (c: CardId) => cardValue(c, trump));
}
