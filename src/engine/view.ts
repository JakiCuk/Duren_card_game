import type { RuleConfig } from '../shared/rules.js';
import type { CardId, Suit } from './cards.js';
import type { GameEvent } from './events.js';
import type { LegalityCtx } from './legality.js';
import { legalMoves } from './legality.js';
import type { Move } from './moves.js';
import type { GameResult, GameState, PlayerId, Seat, TableSlot } from './state.js';

export interface PublicPlayer {
  seat: Seat;
  id: PlayerId;
  handCount: number;
  out: boolean;
  passed: boolean;
}

/**
 * What one participant is allowed to know. Plain data — it is exactly what goes
 * over the wire, so it must survive `JSON.stringify` with nothing lost and
 * nothing leaked.
 */
export interface PlayerView {
  /** Mirrors `GameState.step`; the client echoes it back to reject stale moves. */
  seq: number;
  config: RuleConfig;
  trump: Suit;
  /** The face-up bottom card, when the rules show it and it is still in the deck. */
  trumpCard: CardId | null;
  /** `null` for a spectator. */
  you: { seat: Seat; hand: CardId[] } | null;
  players: PublicPlayer[];
  deckCount: number;
  discardCount: number;
  table: TableSlot[];
  attackerSeat: Seat;
  defenderSeat: Seat;
  defenderTaking: boolean;
  defenderHandAtBoutStart: number;
  boutIndex: number;
  finished: boolean;
  result: GameResult | null;
  /** Precomputed for `you`. Empty for spectators and for a finished game. */
  legalMoves: Move[];
}

/**
 * The one place hidden state can escape.
 *
 * Kept deliberately short and dull, and covered by a test that serializes the
 * result and asserts that no card from another hand or from the deck appears
 * anywhere in it. That test catches every future leak by construction.
 */
export function redact(s: GameState, viewer: Seat | null): PlayerView {
  const me = viewer === null ? null : s.players[viewer];

  const view: PlayerView = {
    seq: s.step,
    config: s.config,
    trump: s.trump,
    trumpCard: s.config.trumpCardVisible ? s.trumpCard : null,
    you: me ? { seat: me.seat, hand: me.hand.slice() } : null,
    players: s.players.map((p) => ({
      seat: p.seat,
      id: p.id,
      handCount: p.hand.length,
      out: p.outAtStep !== null,
      passed: s.passed[p.seat] === true,
    })),
    deckCount: s.deck.length,
    discardCount: s.discard.length,
    table: s.table.map((t) => ({ attack: t.attack, defence: t.defence })),
    attackerSeat: s.attacker,
    defenderSeat: s.defender,
    defenderTaking: s.defenderTaking,
    defenderHandAtBoutStart: s.defenderHandAtBoutStart,
    boutIndex: s.boutIndex,
    finished: s.phase === 'finished',
    result: s.result ? { durak: s.result.durak, order: s.result.order.slice() } : null,
    legalMoves: [],
  };

  view.legalMoves = me && s.phase === 'bout' ? legalMoves(viewCtx(view), me.seat) : [];
  return view;
}

/**
 * Adapts a view to the rules interface, so `legalMoves(viewCtx(view), mySeat)`
 * in the browser runs the very same code as the server's authority check. The
 * two therefore cannot drift apart.
 */
export function viewCtx(v: PlayerView): LegalityCtx {
  return {
    config: v.config,
    trump: v.trump,
    table: v.table,
    attackerSeat: v.attackerSeat,
    defenderSeat: v.defenderSeat,
    defenderTaking: v.defenderTaking,
    defenderHandAtBoutStart: v.defenderHandAtBoutStart,
    boutIndex: v.boutIndex,
    passed: v.players.map((p) => p.passed),
    seats: v.players.map((p) => ({ seat: p.seat, handCount: p.handCount, out: p.out })),
    finished: v.finished,
    handOf: (seat) => (v.you !== null && v.you.seat === seat ? v.you.hand : null),
  };
}

/** The public rendering of an event: no private cards, no engine bookkeeping. */
export type PublicEvent =
  | { k: 'dealt'; trumpCard: CardId; hand: CardId[] | null }
  | { k: 'attack'; seat: Seat; card: CardId; throwIn: boolean }
  | { k: 'defend'; seat: Seat; card: CardId; slot: number }
  | { k: 'takeDeclared'; seat: Seat }
  | { k: 'take'; seat: Seat; cards: CardId[] }
  | { k: 'pass'; seat: Seat }
  | { k: 'bito'; cards: CardId[] }
  | { k: 'draw'; seat: Seat; count: number; cards: CardId[] | null }
  | { k: 'trumpTaken'; seat: Seat; card: CardId }
  | { k: 'out'; seat: Seat }
  | { k: 'gameOver'; result: GameResult };

export function redactEvent(e: GameEvent, viewer: Seat | null): PublicEvent {
  switch (e.k) {
    case 'dealt':
      return {
        k: 'dealt',
        trumpCard: e.trumpCard,
        hand: viewer === null ? null : (e.hands[viewer]?.slice() ?? null),
      };
    case 'draw':
      return {
        k: 'draw',
        seat: e.seat,
        count: e.cards.length,
        cards: e.seat === viewer ? e.cards.slice() : null,
      };
    case 'pass':
      // The `auto` flag is dropped on purpose. A forced pass proves the player
      // holds no card of any rank on the table; a voluntary one proves nothing.
      // At a real table the two look identical, and so must they here.
      return { k: 'pass', seat: e.seat };
    case 'take':
      return { k: 'take', seat: e.seat, cards: e.cards.slice() };
    case 'bito':
      return { k: 'bito', cards: e.cards.slice() };
    case 'gameOver':
      return { k: 'gameOver', result: { durak: e.result.durak, order: e.result.order.slice() } };
    case 'attack':
    case 'defend':
    case 'takeDeclared':
    case 'trumpTaken':
    case 'out':
      return e;
  }
}

export const redactEvents = (events: readonly GameEvent[], viewer: Seat | null): PublicEvent[] =>
  events.map((e) => redactEvent(e, viewer));
