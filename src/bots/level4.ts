import {
  actorsToAct,
  applyMove,
  ctxOf,
  legalMoves,
  rankOf,
  redact,
  suitOf,
  type CardId,
  type GameState,
  type Move,
  type PlayerView,
  type PublicEvent,
  type Seat,
} from '../engine/index.js';
import { nextInt, seedRng, type RngState } from '../engine/rng.js';
import { Belief, type BeliefTable } from './belief.js';
import { CountingMemory } from './counting.js';
import { determinize } from './determinize.js';
import { solveEndgame } from './endgame.js';
import { cardValue, isTrump } from './heuristics.js';
import { createLevel2 } from './level2.js';
import { createLevel3 } from './level3.js';
import { NoLegalMoveError, type BotFactory, type BotPolicy } from './types.js';

export interface Level4Tuning {
  /** Determinizations sampled per candidate move. */
  samples: number;
  /** Bouts to roll out past the current one before evaluating. */
  horizon: number;
  /**
   * How much worse than the best a move may be and still be chosen for its
   * deception value. The whole point: level 4 bluffs only when the bluff is
   * nearly free, because a bluff that costs material is just a mistake with a
   * story attached.
   */
  bluffSlack: number;
  /** Weight on the deception term once a move is inside the slack. */
  bluffWeight: number;
  /**
   * Softmax temperature over the affordable moves.
   *
   * Kept low on purpose. The idea was to stop a human memorising the bot, but
   * it is measurably expensive: at 0.3 the win rate against level 3 falls from
   * 66 % to 51 %, because "occasionally play a worse move" is exactly what it
   * says. At 0.08 it only separates near-exact ties, so the bot is effectively
   * deterministic given its seed. Unpredictability would have to come from
   * somewhere that does not cost material.
   */
  temperature: number;
}

/**
 * Measured against level 3 over paired seeds.
 *
 * The sample count is the lever that matters: 8 samples score 34 %, 18 score
 * 51 %, 64 score 66 %. Below that the search is not weighing moves, it is
 * measuring its own noise. A horizon of four is *worse* than two, which is
 * PIMC's strategy-fusion pathology showing up exactly where the literature says
 * it will.
 *
 * The bluff weight is 0.2 because 0.5 costs six points and 0.2 costs nothing
 * measurable. Bluffing does not beat a bot that draws no inferences about us —
 * against level 3 it is free rather than profitable — but it is what the level
 * is for, and it is what a human opponent will notice.
 */
export const LEVEL4_TUNING: Level4Tuning = {
  samples: 64,
  horizon: 2,
  bluffSlack: 0.35,
  bluffWeight: 0.2,
  temperature: 0.08,
};

/**
 * Level 4 — models the opponent's hand and bluffs on purpose.
 *
 * Belief-weighted perfect-information Monte Carlo: sample deals consistent with
 * everything observed, play each one out briefly with the level-2 policy, and
 * average. Deliberately shallow — PIMC assumes it will *know* the deal at future
 * decision points, and the cure for that is a short horizon and a decent static
 * evaluation, not a bigger search.
 *
 * The endgame still goes to level 3's exact solver: when a position can be
 * solved outright, sampling it is strictly worse.
 */
export function createLevel4(seat: Seat, seed: number | string): BotPolicy {
  return createLevel4Tuned(LEVEL4_TUNING)(seat, seed);
}

/** The same policy with different constants — this is what the sweep drives. */
export function createLevel4Tuned(tuning: Level4Tuning): BotFactory {
  return (seat: Seat, seed: number | string): BotPolicy => build(seat, seed, tuning);
}

function build(seat: Seat, seed: number | string, tuning: Level4Tuning): BotPolicy {
  const memory = new CountingMemory(seat);
  const belief = new Belief(seat);
  const rng: RngState = seedRng(`l4:${String(seed)}:${seat}`);
  // Every seat is rolled out with the same decent policy. Rolling opponents out
  // with "first legal move" makes every deal look alike, and the search then
  // measures nothing but its own noise.
  const rollouts = new Map<Seat, BotPolicy>();
  const rolloutFor = (s: Seat): BotPolicy => {
    let bot = rollouts.get(s);
    if (!bot) {
      bot = createLevel2(s, `${String(seed)}:rollout:${s}`);
      rollouts.set(s, bot);
    }
    return bot;
  };
  const fallback = createLevel3(seat, seed);
  // Buffered rather than dropped: the deal arrives before any view exists.
  let pending: PublicEvent[] = [];

  return {
    level: 4,
    seat,
    observe(events) {
      pending.push(...events);
      fallback.observe(events);
    },
    chooseMove(view: PlayerView): Move {
      if (view.legalMoves.length === 0) throw new NoLegalMoveError(seat);
      memory.observe(pending, view);
      belief.observe(pending, view);
      pending = [];

      // A solved position beats any amount of sampling.
      const solved = solveEndgame(view, memory);
      if (solved !== null) return solved.move;

      const table = belief.fit(view, memory);
      const scored = search(view, memory, table, rng, rolloutFor, tuning, seat);
      if (scored.length === 0) return fallback.chooseMove(view);

      return choose(scored, view, table, memory, tuning, rng);
    },
  };
}

interface Scored {
  move: Move;
  value: number;
}

function search(
  view: PlayerView,
  memory: CountingMemory,
  table: BeliefTable,
  rng: RngState,
  rolloutFor: (seat: Seat) => BotPolicy,
  tuning: Level4Tuning,
  seat: Seat,
): Scored[] {
  const candidates = view.legalMoves;
  if (candidates.length <= 1) return candidates.map((move) => ({ move, value: 0 }));

  // One pool of deals shared by every candidate: comparing moves across
  // *different* deals would measure the luck of the sample, not the move.
  const deals: GameState[] = [];
  for (let i = 0; i < tuning.samples; i++) {
    const deal = determinize(view, memory, table, rng);
    if (deal !== null) deals.push(deal);
  }
  if (deals.length === 0) return [];

  return candidates.map((move) => {
    let total = 0;
    for (const deal of deals) {
      let state: GameState;
      try {
        state = applyMove(deal, move).state;
      } catch {
        // The sampled deal did not admit this move; treat it as neutral rather
        // than letting one bad sample veto a good candidate.
        continue;
      }
      total += playOut(state, seat, rolloutFor, tuning.horizon);
    }
    return { move, value: total / deals.length };
  });
}

/** Plays the position forward with a cheap policy, then scores what is left. */
function playOut(
  start: GameState,
  me: Seat,
  rolloutFor: (seat: Seat) => BotPolicy,
  horizon: number,
): number {
  let state = start;
  const stopBout = state.boutIndex + horizon;

  for (let step = 0; step < 200; step++) {
    if (state.phase === 'finished') break;
    if (state.boutIndex > stopBout) break;
    const actors = actorsToAct(state);
    if (actors.length === 0) break;
    const seat = actors[0]!;
    const moves = legalMoves(ctxOf(state), seat);
    if (moves.length === 0) break;
    state = applyMove(state, rolloutFor(seat).chooseMove(redact(state, seat))).state;
  }
  return evaluate(state, me);
}

/**
 * How good the position is for us, in roughly "cards ahead".
 *
 * Being out is worth a lot and being the durak costs a lot, because those are
 * the only things the game actually scores; everything else is a proxy for
 * getting there.
 */
function evaluate(state: GameState, me: Seat): number {
  if (state.phase === 'finished') {
    const durak = state.result?.durak;
    if (durak === null || durak === undefined) return 4;
    return durak === state.players[me]?.id ? -20 : 8;
  }

  const mine = state.players[me];
  if (!mine) return 0;
  const others = state.players.filter((p) => p.seat !== me && p.outAtStep === null);
  const avgOpponent = others.length === 0 ? 0 : others.reduce((n, p) => n + p.hand.length, 0) / others.length;

  const trumpStrength = (cards: readonly CardId[]): number =>
    cards.reduce((n, c) => n + (suitOf(c) === state.trump ? 1 + rankOf(c) / 12 : 0), 0);

  const myTrumps = trumpStrength(mine.hand);
  const theirTrumps = others.reduce((n, p) => n + trumpStrength(p.hand), 0) / Math.max(others.length, 1);

  return (
    1.6 * (avgOpponent - mine.hand.length) +
    3.0 * (myTrumps - theirTrumps) +
    (mine.outAtStep !== null ? 8 : 0) +
    0.8 * (state.attacker === me ? 1 : 0)
  );
}

/**
 * Picks among the moves the search rates highly.
 *
 * Two things happen here that a pure argmax would not do. Moves within
 * `bluffSlack` of the best are re-ranked by how much they mislead — that is the
 * bluff, and the slack is what keeps it honest. Then a softmax over what is
 * left keeps the bot from being a lookup table that a human can memorise.
 */
function choose(
  scored: Scored[],
  view: PlayerView,
  table: BeliefTable,
  memory: CountingMemory,
  tuning: Level4Tuning,
  rng: RngState,
): Move {
  const best = Math.max(...scored.map((s) => s.value));
  const range = Math.max(best - Math.min(...scored.map((s) => s.value)), 1);
  const affordable = scored.filter((s) => s.value >= best - tuning.bluffSlack * range);

  const ranked = affordable.map((s) => ({
    move: s.move,
    score: s.value + tuning.bluffWeight * deception(s.move, view, table, memory),
  }));

  const top = Math.max(...ranked.map((r) => r.score));
  const weights = ranked.map((r) => Math.exp((r.score - top) / Math.max(tuning.temperature * range, 1e-6)));
  const total = weights.reduce((a, b) => a + b, 0);
  let pick = (nextInt(rng, 1_000_000) / 1_000_000) * total;
  for (let i = 0; i < ranked.length; i++) {
    pick -= weights[i]!;
    if (pick <= 0) return ranked[i]!.move;
  }
  return ranked[ranked.length - 1]!.move;
}

/**
 * How much a move misleads, in the same units as the evaluation.
 *
 * The design called for running our own belief code from the opponent's seat
 * and measuring how far their posterior moves away from the truth. What is
 * implemented instead is the four named bluffs that the measurement would have
 * produced anyway, scored directly. It is far cheaper, and — unlike a number
 * that falls out of a second belief fit — you can read it and say whether it is
 * right.
 */
function deception(
  move: Move,
  view: PlayerView,
  table: BeliefTable,
  memory: CountingMemory,
): number {
  const trump = view.trump;
  const hand = view.you?.hand ?? [];
  const opponents = table.opponents;
  if (opponents.length === 0) return 0;

  switch (move.t) {
    case 'TAKE': {
      // Taking when we *could* have beaten it says "I have nothing", which is
      // exactly what an opponent will believe and exactly what is false. Worth
      // most when the cards it conceals are good ones.
      const beaters = view.legalMoves.filter((m) => m.t === 'DEFEND');
      if (beaters.length === 0) return 0;
      const concealed = Math.max(...beaters.map((m) => cardValue(m.card, trump)));
      return concealed / 10;
    }

    case 'PASS': {
      // Declining to throw in a rank we hold hides that rank — useful later as
      // a transfer, or as bait for an attack they think is safe.
      const ranks = new Set(view.table.flatMap((t) => [rankOf(t.attack), ...(t.defence === null ? [] : [rankOf(t.defence)])]));
      const hidden = hand.filter((c) => ranks.has(rankOf(c)));
      return hidden.length === 0 ? 0 : 0.6 * hidden.length;
    }

    case 'ATTACK': {
      // Leading our only card of a suit suggests we hold more of it, which can
      // buy a trump we would otherwise have had to face later.
      const suit = suitOf(move.card);
      if (isTrump(move.card, trump)) return 0;
      const sameSuit = hand.filter((c) => suitOf(c) === suit).length;
      const looksDeep = sameSuit === 1 ? 1 : 0;
      // Worth more against somebody who is actually watching: a level-1 bot
      // draws no conclusions, so bluffing it is pure loss.
      const attentive = table.canBeat(opponents[0]!, move.card);
      return looksDeep * (0.5 + attentive);
    }

    case 'TRANSFER': {
      // Passing the bout on with a rank they cannot match leaves them holding
      // a problem and tells them nothing useful about our hand.
      const chance = table.holdsRank(opponents[0]!, rankOf(move.card));
      return (1 - chance) * 0.8;
    }

    case 'DEFEND':
      // An ordinary defence reveals the card and nothing else.
      return memory.isUnbeatable(view, move.card) ? -0.5 : 0;
  }
}
