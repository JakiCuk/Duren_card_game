import {
  rankOf,
  type CardId,
  type Move,
  type PlayerView,
  type PublicEvent,
  type Seat,
} from '../engine/index.js';
import { CountingMemory } from './counting.js';
import { solveEndgame } from './endgame.js';
import {
  attackMoves,
  cardValue,
  defendMoves,
  isTrump,
  passMove,
  phaseOf,
  pickCheapest,
  takeMove,
  transferMoves,
  unbeatenSlots,
} from './heuristics.js';
import { createLevel2, LEVEL2_TUNING } from './level2.js';
import { atLeastOne } from './probability.js';
import { NoLegalMoveError, type BotPolicy } from './types.js';

/**
 * Level 3 — counts cards.
 *
 * Three things separate it from level 2, in descending order of how much they
 * matter:
 *
 * 1. **The endgame is solved, not guessed.** Heads-up with an empty deck the
 *    opponent's hand is fully determined, so the bot plays it perfectly.
 * 2. **It knows what is unbeatable.** A card nothing left in play can beat is
 *    held back as a guaranteed winner instead of being spent as junk.
 * 3. **It attacks with what hurts.** Among cards worth spending, it leads the
 *    one the defender is least likely to be able to answer.
 *
 * Everything else falls through to level 2, which is already tuned; rewriting
 * it here would be duplication pretending to be sophistication.
 */
export function createLevel3(seat: Seat, seed: number | string): BotPolicy {
  const memory = new CountingMemory(seat);
  const fallback = createLevel2(seat, seed);
  // Events can arrive before any view — the deal itself does. Buffering them
  // instead of dropping them is the difference between a bot that counts and
  // one that thinks the game started on its first turn.
  let pending: PublicEvent[] = [];

  return {
    level: 3,
    seat,
    observe(events) {
      pending.push(...events);
    },
    chooseMove(view: PlayerView): Move {
      if (view.legalMoves.length === 0) throw new NoLegalMoveError(seat);
      memory.observe(pending, view);
      pending = [];

      const solved = solveEndgame(view, memory);
      if (solved !== null) return solved.move;

      return (
        transferChoice(view) ??
        defenceChoice(view, memory) ??
        attackChoice(view, memory) ??
        fallback.chooseMove(view)
      );
    },
  };
}

/** Passing the bout on is worth a cheap plain card, exactly as at level 2. */
function transferChoice(view: PlayerView): Move | undefined {
  return pickCheapest(
    transferMoves(view).filter((m) => !m.reveal && !isTrump(m.card, view.trump)),
    (c) => cardValue(c, view.trump),
  );
}

function defenceChoice(view: PlayerView, memory: CountingMemory): Move | undefined {
  const defends = defendMoves(view);
  const take = takeMove(view);
  if (defends.length === 0) return take !== undefined && unbeatenSlots(view).length > 0 ? take : undefined;

  const trump = view.trump;
  const open = unbeatenSlots(view);

  const covers = open.map((slot) =>
    pickCheapest(
      defends.filter((m) => m.slot === slot),
      // A card that cannot be beaten is worth far more than its rank suggests:
      // spending it here throws away a guaranteed winner.
      (c) => cardValue(c, trump) + (memory.isUnbeatable(view, c) ? 12 : 0),
    ),
  );
  if (covers.some((m) => m === undefined)) return take;

  const chosen = covers.filter((m) => m !== undefined);
  const spend = chosen.reduce((sum, m) => sum + cardValue(m.card, trump), 0);
  const worth = open.reduce((sum, slot) => sum + cardValue(view.table[slot]!.attack, trump), 0);
  const absorbed = view.table.reduce((n, s) => n + (s.defence === null ? 1 : 2), 0);
  const slack = LEVEL2_TUNING.overpaySlack[phaseOf(view)] + absorbed * LEVEL2_TUNING.absorbPenalty;

  if (take !== undefined && spend - worth > slack) return take;
  return chosen[0] ?? take;
}

function attackChoice(view: PlayerView, memory: CountingMemory): Move | undefined {
  const attacks = attackMoves(view);
  if (attacks.length === 0) return undefined;

  const trump = view.trump;
  const phase = phaseOf(view);
  const defender = view.players.find((p) => p.seat === view.defenderSeat);
  if (!defender) return undefined;

  const pool = memory.unknownPool(view);
  const unknownInHand = memory.unknownHandSize(view, defender.seat);
  const named = memory.cardsKnownIn(defender.seat);

  /** How likely the defender can answer this card at all. */
  const answerChance = (card: CardId): number => {
    // A card we have watched them pick up is a certainty, not a probability.
    if (named.some((c) => beatsWith(c, card, trump))) return 1;
    const beaters = memory.beatersLeft(view, card).length;
    return atLeastOne(pool.length, beaters, unknownInHand);
  };

  const spendable = attacks.filter((m) => {
    if (isTrump(m.card, trump)) {
      return phase === 'endgame' && LEVEL2_TUNING.throwInTrumpsInEndgame;
    }
    if (view.table.length === 0) return true;
    return rankOf(m.card) <= LEVEL2_TUNING.throwInMax[phase];
  });
  if (spendable.length === 0) return passMove(view);

  // Hold back anything nothing can beat: it is a guaranteed last-bout winner,
  // and there is no point spending it while cheaper cards do the same job.
  const keepWinners = spendable.filter(
    (m) => !memory.isUnbeatable(view, m.card) || spendable.length === 1,
  );
  const pool2 = keepWinners.length > 0 ? keepWinners : spendable;

  // Among cards we are willing to spend, lead the one they are least likely to
  // answer — cost still matters, so it is a trade-off rather than a rule.
  return pickCheapest(pool2, (c) => cardValue(c, trump) * 0.6 + answerChance(c) * 10);
}

/** Local copy so the scoring above reads as one thought. */
function beatsWith(defence: CardId, attack: CardId, trump: number): boolean {
  const ds = defence & 3;
  const as = attack & 3;
  return ds === as ? defence >> 2 > attack >> 2 : ds === trump;
}
