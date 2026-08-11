import type { Move, PlayerView, PublicEvent, Seat } from '../engine/index.js';

export type BotLevel = 1 | 2 | 3 | 4;

/**
 * A bot receives a redacted `PlayerView` and the public event log. It never
 * sees a `GameState`, and the lint rules stop it from importing anything that
 * holds one.
 *
 * "Does the AI cheat?" is therefore answerable by reading this one type rather
 * than by auditing every policy.
 */
export interface BotPolicy {
  readonly level: BotLevel;
  readonly seat: Seat;
  /** Public events the bot has not seen yet, oldest first. */
  observe(events: readonly PublicEvent[]): void;
  chooseMove(view: PlayerView): Move;
}

export type BotFactory = (seat: Seat, seed: number | string) => BotPolicy;

export class NoLegalMoveError extends Error {
  constructor(seat: Seat) {
    super(`Bot at seat ${seat} was asked to move with no legal moves available`);
    this.name = 'NoLegalMoveError';
  }
}
