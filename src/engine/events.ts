import type { CardId } from './cards.js';
import type { GameResult, Seat } from './state.js';

/**
 * The engine's record of what happened. This is the *full truth*, including
 * private payloads (`dealt.hands`, `draw.cards`) and engine internals
 * (`pass.auto`). Redaction into a per-player `PublicEvent` happens in the view
 * layer — the engine records, it does not decide who may see what.
 */
export type GameEvent =
  | { k: 'dealt'; hands: CardId[][]; trumpCard: CardId }
  | { k: 'attack'; seat: Seat; card: CardId; throwIn: boolean }
  | { k: 'defend'; seat: Seat; card: CardId; slot: number }
  /** Perevodnoy: `seat` handed the defence to `to`. A revealed card stays in hand. */
  | { k: 'transfer'; seat: Seat; to: Seat; card: CardId; revealed: boolean }
  /** The defender declared "I take". The cards do not move until the bout resolves. */
  | { k: 'takeDeclared'; seat: Seat }
  | { k: 'take'; seat: Seat; cards: CardId[] }
  | {
      k: 'pass';
      seat: Seat;
      /**
       * True when the engine passed for a player who had no legal throw-in.
       *
       * This flag must never reach other players: a forced pass proves the
       * player holds no card of any rank on the table, while a voluntary pass
       * proves nothing. At a real table the two are indistinguishable, and the
       * redaction layer keeps it that way.
       */
      auto: boolean;
    }
  | { k: 'bito'; cards: CardId[] }
  | { k: 'draw'; seat: Seat; cards: CardId[] }
  | { k: 'trumpTaken'; seat: Seat; card: CardId }
  | { k: 'out'; seat: Seat }
  | { k: 'gameOver'; result: GameResult };

export type GameEventKind = GameEvent['k'];
