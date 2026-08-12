import {
  actorsToAct,
  ctxOf,
  legalMoves,
  viewCtx,
  type CardId,
  type GameResult,
  type GameState,
  type Move,
  type PlayerView,
  type Seat,
  type Suit,
  type TableSlot,
} from '../../engine/index.js';

export interface BoardSeat {
  seat: Seat;
  name: string;
  handCount: number;
  /** Cards to draw face up, or `null` to draw backs. */
  hand: CardId[] | null;
  out: boolean;
  passed: boolean;
  isBot: boolean;
  /** `false` renders the seat as away. Always true for bots and hot-seat. */
  connected: boolean;
  /** A stand-in is playing this seat because nobody came back for it. */
  substituted: boolean;
  /** `null` in a free-for-all. */
  team: 0 | 1 | null;
}

/**
 * Everything the board needs to draw itself, and nothing about where it came
 * from.
 *
 * Two producers feed it: the local engine (hot seat, which may show every hand)
 * and a redacted `PlayerView` from the server (which cannot). Without this seam
 * the board would either need two versions or would have to be told about the
 * network — and the online one would be tempted to reach for cards it must not
 * have.
 */
export interface BoardModel {
  trump: Suit;
  trumpCard: CardId | null;
  deckCount: number;
  discardCount: number;
  table: TableSlot[];
  attackerSeat: Seat;
  defenderSeat: Seat;
  defenderTaking: boolean;
  boutIndex: number;
  finished: boolean;
  result: GameResult | null;
  seats: BoardSeat[];
  /** Seats that could act now — used for highlighting, not for permission. */
  actors: Seat[];
  /** Seats this client may actually play for. */
  controllable: Seat[];
  movesFor: (seat: Seat) => Move[];
}

export interface LocalModelOptions {
  seatName: (seat: Seat) => string;
  /** Seats played by a bot: their cards stay face down. */
  isBot: (seat: Seat) => boolean;
}

/** Hot seat and versus-bot: the client holds the whole game. */
export function modelFromState(state: GameState, opts: LocalModelOptions): BoardModel {
  const actors = actorsToAct(state);
  return {
    trump: state.trump,
    trumpCard: state.config.trumpCardVisible ? state.trumpCard : null,
    deckCount: state.deck.length,
    discardCount: state.discard.length,
    table: state.table,
    attackerSeat: state.attacker,
    defenderSeat: state.defender,
    defenderTaking: state.defenderTaking,
    boutIndex: state.boutIndex,
    finished: state.phase === 'finished',
    result: state.result,
    seats: state.players.map((p) => ({
      seat: p.seat,
      name: opts.seatName(p.seat),
      handCount: p.hand.length,
      hand: opts.isBot(p.seat) ? null : p.hand,
      out: p.outAtStep !== null,
      passed: state.passed[p.seat] === true,
      isBot: opts.isBot(p.seat),
      connected: true,
      substituted: false,
      team: state.config.teams === null ? null : ((p.seat % 2) as 0 | 1),
    })),
    actors,
    controllable: actors.filter((s) => !opts.isBot(s)),
    movesFor: (seat) => (state.phase === 'bout' ? legalMoves(ctxOf(state), seat) : []),
  };
}

export interface RemoteModelOptions {
  seatName: (seat: Seat) => string;
  isBot: (seat: Seat) => boolean;
  connected: (seat: Seat) => boolean;
  substituted: (seat: Seat) => boolean;
}

/**
 * Online: the client knows only what the server told it.
 *
 * `actors` is deliberately approximate — the client cannot see other hands, so
 * it cannot know whether an opponent has a legal move. It highlights whoever
 * has not passed, which is all a spectator could tell anyway.
 */
export function modelFromView(view: PlayerView, opts: RemoteModelOptions): BoardModel {
  const mySeat = view.you?.seat ?? null;
  const iCanAct = mySeat !== null && view.legalMoves.length > 0;

  const others = view.players
    .filter((p) => !p.out && p.handCount > 0 && p.seat !== mySeat && !p.passed)
    .map((p) => p.seat);

  return {
    trump: view.trump,
    trumpCard: view.trumpCard,
    deckCount: view.deckCount,
    discardCount: view.discardCount,
    table: view.table,
    attackerSeat: view.attackerSeat,
    defenderSeat: view.defenderSeat,
    defenderTaking: view.defenderTaking,
    boutIndex: view.boutIndex,
    finished: view.finished,
    result: view.result,
    seats: view.players.map((p) => ({
      seat: p.seat,
      name: opts.seatName(p.seat),
      handCount: p.handCount,
      hand: p.seat === mySeat ? (view.you?.hand ?? []) : null,
      out: p.out,
      passed: p.passed,
      isBot: opts.isBot(p.seat),
      connected: opts.connected(p.seat),
      substituted: opts.substituted(p.seat),
      team: p.team,
    })),
    actors: [...(iCanAct && mySeat !== null ? [mySeat] : []), ...others],
    controllable: iCanAct && mySeat !== null ? [mySeat] : [],
    movesFor: (seat) => (seat === mySeat && !view.finished ? legalMoves(viewCtx(view), seat) : []),
  };
}
