import {
  actorsToAct,
  applyMove,
  assembleState,
  ctxOf,
  legalMoves,
  type CardId,
  type GameState,
  type Move,
  type PlayerView,
  type Seat,
} from '../engine/index.js';
import type { CountingMemory } from './counting.js';

export interface EndgameResult {
  move: Move;
  /** +1 we win, 0 a draw, −1 we are the durak. */
  value: number;
  nodes: number;
}

/** Beyond this the search is abandoned and the heuristic policy decides. */
const DEFAULT_BUDGET = 40_000;

/**
 * Perfect play for the phase that decides the game.
 *
 * Heads-up with an empty deck there is nothing left to guess: every card is
 * either ours, discarded, on the table, or in the opponent's hand. The position
 * is a finite two-player game with no hidden information, so it can simply be
 * solved — no sampling, no evaluation function, no approximation.
 */
export function solveEndgame(
  view: PlayerView,
  memory: CountingMemory,
  budget = DEFAULT_BUDGET,
): EndgameResult | null {
  const me = view.you?.seat;
  if (me === undefined || view.finished) return null;
  if (!memory.opponentHandIsKnown(view)) return null;

  const opponent = view.players.find((p) => p.seat !== me);
  if (!opponent) return null;

  const theirHand = memory.opponentHand(view, opponent.seat);
  // If the reconstruction disagrees with the count the server reports, our
  // bookkeeping is wrong somewhere and a "perfect" answer would be nonsense.
  if (theirHand.length !== opponent.handCount) return null;

  const hands: CardId[][] = [];
  hands[me] = [...(view.you?.hand ?? [])];
  hands[opponent.seat] = theirHand;

  const state = assembleState({
    config: view.config,
    trump: view.trump,
    trumpCard: null,
    hands,
    deck: [],
    table: view.table,
    attacker: view.attackerSeat,
    defender: view.defenderSeat,
    defenderTaking: view.defenderTaking,
    defenderHandAtBoutStart: view.defenderHandAtBoutStart,
    passed: view.players.map((p) => p.passed),
    transfersThisBout: view.transfersThisBout,
    boutIndex: view.boutIndex,
    step: view.seq,
  });

  const search = new Search(me, budget);
  const best = search.best(state);
  return best === null ? null : { ...best, nodes: search.nodes };
}

/**
 * Identity of a *position*, not of a game.
 *
 * `hashState` deliberately includes the move counter, so it never repeats — as
 * a transposition key it would turn the table into dead weight. Two positions
 * are the same for search purposes when the cards, roles and pass flags match,
 * however many moves it took to get there.
 */
function positionKey(state: GameState): string {
  return [
    state.players.map((p) => p.hand.join(',')).join('/'),
    state.table.map((t) => `${t.attack}:${t.defence ?? -1}`).join(','),
    state.attacker,
    state.defender,
    state.defenderTaking ? 1 : 0,
    state.defenderHandAtBoutStart,
    state.passed.map((b) => (b ? 1 : 0)).join(''),
  ].join('|');
}

class Search {
  nodes = 0;
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly me: Seat,
    private readonly budget: number,
  ) {}

  best(state: GameState): { move: Move; value: number } | null {
    // Our own moves, not the mover heuristic's: when both sides can act the
    // heuristic prefers the defender, and returning its choice would hand the
    // caller a move for the wrong seat.
    const options = legalMoves(ctxOf(state), this.me);
    if (options.length === 0) return null;

    let bestMove = options[0]!;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (const move of options) {
      const value = this.value(applyMove(state, move).state, -1, 1);
      if (value > bestValue) {
        bestValue = value;
        bestMove = move;
        if (value >= 1) break; // a win is a win
      }
      if (this.nodes > this.budget) return null;
    }
    return { move: bestMove, value: bestValue };
  }

  /**
   * Whose turn it is.
   *
   * Both players can legally act at once — an attacker may throw in while the
   * defender is still thinking. The search picks the defender first, which
   * keeps the tree a proper alternating game. It costs the attacker the option
   * of piling on *before* a defence, which changes nothing material: the cards
   * end up in the same place either way.
   */
  private mover(state: GameState): Seat | null {
    const actors = actorsToAct(state);
    if (actors.length === 0) return null;
    return actors.includes(state.defender) ? state.defender : actors[0]!;
  }

  private value(state: GameState, alpha: number, beta: number): number {
    this.nodes++;
    if (state.phase === 'finished') {
      const durak = state.result?.durak;
      if (durak === undefined || durak === null) return 0;
      return durak === state.players[this.me]?.id ? -1 : 1;
    }
    if (this.nodes > this.budget) return 0;

    const key = positionKey(state);
    const cached = this.seen.get(key);
    if (cached !== undefined) return cached;

    const seat = this.mover(state);
    if (seat === null) return 0;
    const maximizing = seat === this.me;
    let value = maximizing ? -1 : 1;

    for (const move of legalMoves(ctxOf(state), seat)) {
      const child = this.value(applyMove(state, move).state, alpha, beta);
      if (maximizing) {
        value = Math.max(value, child);
        alpha = Math.max(alpha, value);
      } else {
        value = Math.min(value, child);
        beta = Math.min(beta, value);
      }
      if (beta <= alpha) break;
      if (this.nodes > this.budget) break;
    }

    this.seen.set(key, value);
    return value;
  }
}
