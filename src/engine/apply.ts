import type { CardId } from './cards.js';
import { compareCards } from './cards.js';
import type { GameEvent } from './events.js';
import {
  boutIsResolvable,
  ctxOf,
  eligibleAttackers,
  hasLegalAttack,
  isLegal,
  transferTarget,
} from './legality.js';
import type { Move } from './moves.js';
import { moveKey } from './moves.js';
import type { GameResult, GameState, PlayerState, Seat } from './state.js';
import {
  activeSeats,
  cloneState,
  MAX_BOUTS_WITHOUT_PROGRESS,
  nextActiveFrom,
  playerAt,
  seatCount,
  tableCards,
} from './state.js';

export class IllegalMoveError extends Error {
  readonly move: Move;
  readonly reason: string;

  constructor(move: Move, reason: string) {
    super(`Illegal move ${moveKey(move)}: ${reason}`);
    this.name = 'IllegalMoveError';
    this.move = move;
    this.reason = reason;
  }
}

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}

/**
 * The only mutator. Bout resolution, refill, out-detection and game end all
 * happen inside it, so `applyMove` is closed over the entire rules surface and
 * there is no state the caller has to "tick" forward.
 */
export function applyMove(state: GameState, move: Move): ApplyResult {
  if (state.phase === 'finished') throw new IllegalMoveError(move, 'game_finished');
  if (!isLegal(ctxOf(state), move)) throw new IllegalMoveError(move, 'not_legal');

  const s = cloneState(state);
  const events: GameEvent[] = [];
  s.step += 1;

  switch (move.t) {
    case 'ATTACK': {
      takeFromHand(playerAt(s, move.seat), move.card);
      const throwIn = s.table.length > 0;
      s.table.push({ attack: move.card, defence: null });
      events.push({ k: 'attack', seat: move.seat, card: move.card, throwIn });
      clearPassed(s);
      break;
    }
    case 'DEFEND': {
      takeFromHand(playerAt(s, move.seat), move.card);
      s.table[move.slot]!.defence = move.card;
      events.push({ k: 'defend', seat: move.seat, card: move.card, slot: move.slot });
      clearPassed(s);
      break;
    }
    case 'TRANSFER': {
      const from = move.seat;
      const to = transferTarget(ctxOf(s));
      if (!move.reveal) {
        takeFromHand(playerAt(s, from), move.card);
        s.table.push({ attack: move.card, defence: null });
      }
      events.push({ k: 'transfer', seat: from, to, card: move.card, revealed: move.reveal });

      s.defender = to;
      // Two-handed perevodnoy bounces the attack straight back at the attacker,
      // so the player who just passed it on becomes the attacking side.
      if (s.attacker === to) s.attacker = from;
      s.transfersThisBout += 1;
      s.defenderHandAtBoutStart = playerAt(s, to).hand.length;
      clearPassed(s);
      break;
    }
    case 'TAKE': {
      s.defenderTaking = true;
      events.push({ k: 'takeDeclared', seat: move.seat });
      // A declared take re-opens throw-ins, so everyone gets another say.
      clearPassed(s);
      break;
    }
    case 'PASS': {
      s.passed[move.seat] = true;
      events.push({ k: 'pass', seat: move.seat, auto: false });
      break;
    }
  }

  autoPass(s, events);
  resolveIfDone(s, events);
  return { state: s, events };
}

function takeFromHand(p: PlayerState, card: CardId): void {
  const i = p.hand.indexOf(card);
  if (i < 0) throw new Error(`Seat ${p.seat} does not hold card ${card}`);
  p.hand.splice(i, 1);
}

const clearPassed = (s: GameState): void => {
  s.passed.fill(false);
};

/**
 * Pass on behalf of anyone who cannot throw in, so the UI never prompts a
 * player whose only move is "pass" and bots never burn a turn on it.
 *
 * The resulting event is flagged `auto` because it is *not* public information:
 * a forced pass proves the player holds no card of any rank on the table.
 */
function autoPass(s: GameState, events: GameEvent[]): void {
  if (s.table.length === 0) return;
  const ctx = ctxOf(s);
  for (const seat of eligibleAttackers(ctx)) {
    if (s.passed[seat] === true) continue;
    if (!hasLegalAttack(ctx, seat)) {
      s.passed[seat] = true;
      events.push({ k: 'pass', seat, auto: true });
    }
  }
}

function resolveIfDone(s: GameState, events: GameEvent[]): void {
  if (!boutIsResolvable(ctxOf(s))) return;

  const defenderSeat = s.defender;
  const wasTaken = s.defenderTaking;
  const cards = tableCards(s);
  const deckBefore = s.deck.length;

  if (wasTaken) {
    const defender = playerAt(s, defenderSeat);
    defender.hand.push(...cards);
    defender.hand.sort(compareCards);
    events.push({ k: 'take', seat: defenderSeat, cards: cards.slice() });
  } else {
    s.discard.push(...cards);
    events.push({ k: 'bito', cards: cards.slice() });
  }

  s.table = [];
  s.defenderTaking = false;

  // Refill runs before the roles rotate: the primary attacker draws first, then
  // clockwise, and the defender draws last.
  refill(s, events);

  for (const p of s.players) {
    if (p.outAtStep === null && p.hand.length === 0 && s.deck.length === 0) {
      p.outAtStep = s.step;
      events.push({ k: 'out', seat: p.seat });
    }
  }

  // "Progress" means cards left play or the deck shrank. A run of pure takes
  // moves cards between hands without either, which is exactly the shape of a
  // cycle.
  s.boutsWithoutProgress = !wasTaken || s.deck.length < deckBefore ? 0 : s.boutsWithoutProgress + 1;

  const active = activeSeats(s);
  if (active.length <= 1) {
    finish(s, events, active, 'played_out');
    return;
  }
  if (s.boutsWithoutProgress >= MAX_BOUTS_WITHOUT_PROGRESS) {
    finish(s, events, [], 'stalemate');
    return;
  }

  const n = seatCount(s);
  // Beaten: the defender earned the attack. Taken: they are skipped exactly once.
  s.attacker = wasTaken
    ? nextActiveFrom(s, (defenderSeat + 1) % n)
    : nextActiveFrom(s, defenderSeat);
  s.defender = nextActiveFrom(s, (s.attacker + 1) % n);
  s.defenderHandAtBoutStart = playerAt(s, s.defender).hand.length;
  s.boutIndex += 1;
  s.passed.fill(false);
  s.transfersThisBout = 0;
}

function refill(s: GameState, events: GameEvent[]): void {
  const n = seatCount(s);
  const order: Seat[] = [];
  for (let i = 0; i < n; i++) {
    const seat = (s.attacker + i) % n;
    if (seat !== s.defender) order.push(seat);
  }
  order.push(s.defender);

  for (const seat of order) {
    if (s.deck.length === 0) break;
    const p = playerAt(s, seat);
    if (p.outAtStep !== null) continue;

    const drawn: CardId[] = [];
    while (p.hand.length < s.config.handSize && s.deck.length > 0) {
      const card = s.deck.shift()!;
      drawn.push(card);
      p.hand.push(card);
      if (s.deck.length === 0) {
        // Whoever draws the last card takes the face-up trump card with it.
        s.trumpCard = null;
        events.push({ k: 'trumpTaken', seat, card });
      }
    }
    if (drawn.length > 0) {
      p.hand.sort(compareCards);
      events.push({ k: 'draw', seat, cards: drawn });
    }
  }
}

function finish(
  s: GameState,
  events: GameEvent[],
  active: Seat[],
  reason: GameResult['reason'],
): void {
  const order = s.players
    .filter((p) => p.outAtStep !== null)
    .sort((a, b) => a.outAtStep! - b.outAtStep! || a.seat - b.seat)
    .map((p) => p.id);

  const durakSeat = active[0];
  const result: GameResult = {
    durak: durakSeat === undefined ? null : playerAt(s, durakSeat).id,
    order,
    reason,
  };

  s.result = result;
  s.phase = 'finished';
  events.push({
    k: 'gameOver',
    result: { durak: result.durak, order: result.order.slice(), reason },
  });
}

/** Convenience for tests and replays: fold a move list over a starting state. */
export function applyMoves(state: GameState, moves: readonly Move[]): ApplyResult {
  let current = state;
  const events: GameEvent[] = [];
  for (const move of moves) {
    const step = applyMove(current, move);
    current = step.state;
    events.push(...step.events);
  }
  return { state: current, events };
}
