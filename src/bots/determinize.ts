import {
  assembleState,
  type CardId,
  type GameState,
  type PlayerView,
  type Seat,
} from '../engine/index.js';
import { nextInt, type RngState } from '../engine/rng.js';
import { DECK, type BeliefTable } from './belief.js';
import type { CountingMemory } from './counting.js';

/**
 * Turns "who probably holds what" into one concrete deal the engine can play.
 *
 * Cards we have actually watched go into a hand are placed first and are not
 * negotiable; the rest are sampled without replacement, weighted by the belief,
 * with each holder's column closed once it is full.
 *
 * A dead end — a card with nowhere left to go — is possible when the weights
 * are lopsided, so the whole assignment is retried a few times before falling
 * back to a uniform shuffle. A slightly wrong deal is a far smaller problem
 * than no deal at all.
 */
export function determinize(
  view: PlayerView,
  memory: CountingMemory,
  belief: BeliefTable,
  rng: RngState,
): GameState | null {
  const mySeat = view.you?.seat;
  if (mySeat === undefined) return null;

  for (let attempt = 0; attempt < 8; attempt++) {
    const deal = tryAssign(view, memory, belief, rng, attempt >= 6);
    if (deal !== null) return build(view, mySeat, deal);
  }
  return null;
}

interface Deal {
  hands: CardId[][];
  deck: CardId[];
}

function tryAssign(
  view: PlayerView,
  memory: CountingMemory,
  belief: BeliefTable,
  rng: RngState,
  uniform: boolean,
): Deal | null {
  const hands: CardId[][] = view.players.map((p) =>
    p.seat === view.you?.seat ? [...(view.you?.hand ?? [])] : [...memory.cardsKnownIn(p.seat)],
  );
  const room = new Map<Seat, number>();
  for (const holder of belief.holders) room.set(holder, belief.capacity.get(holder) ?? 0);

  const pool = [...belief.unknown];
  // Shuffle so the sampling order does not bias which holder fills up first.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }

  const deck: CardId[] = [];
  for (const card of pool) {
    const options = belief.holders.filter((h) => (room.get(h) ?? 0) > 0);
    if (options.length === 0) return null;

    const weights = options.map((h) => (uniform ? 1 : Math.max(belief.probability(h, card), 1e-6)));
    const total = weights.reduce((a, b) => a + b, 0);
    let pick = (nextInt(rng, 1_000_000) / 1_000_000) * total;
    let chosen = options[options.length - 1]!;
    for (let i = 0; i < options.length; i++) {
      pick -= weights[i]!;
      if (pick <= 0) {
        chosen = options[i]!;
        break;
      }
    }

    room.set(chosen, (room.get(chosen) ?? 0) - 1);
    if (chosen === DECK) deck.push(card);
    else hands[chosen]!.push(card);
  }

  // Every hand must end up the size the server says it is, or the engine will
  // refuse the position and the whole rollout is wasted.
  for (const p of view.players) {
    if ((hands[p.seat]?.length ?? 0) !== p.handCount) return null;
  }
  return { hands, deck };
}

function build(view: PlayerView, mySeat: Seat, deal: Deal): GameState {
  // The trump card sits at the bottom, which is where the engine expects it.
  const deck = view.trumpCard === null ? deal.deck : [...deal.deck, view.trumpCard];
  return assembleState({
    config: view.config,
    trump: view.trump,
    trumpCard: view.trumpCard,
    hands: deal.hands,
    deck,
    table: view.table,
    attacker: view.attackerSeat,
    defender: view.defenderSeat,
    defenderTaking: view.defenderTaking,
    defenderHandAtBoutStart: view.defenderHandAtBoutStart,
    passed: view.players.map((p) => p.passed),
    transfersThisBout: view.transfersThisBout,
    boutIndex: view.boutIndex,
    step: view.seq,
    outAtStep: view.players.map((p) => (p.out ? 0 : null)),
    playerIds: view.players.map((p) => p.id),
    seed: `pimc:${mySeat}:${view.seq}`,
  });
}
