import type { RuleConfig } from '../shared/rules.js';
import { isPlayable, validateConfig } from '../shared/rules.js';
import type { CardId, Suit } from './cards.js';
import { compareCards, fullDeck, suitOf } from './cards.js';
import type { GameEvent } from './events.js';
import type { RngState } from './rng.js';
import { cloneRng, nextInt, seedRng, shuffleInPlace } from './rng.js';

export type PlayerId = string;
/** Index into `GameState.players`, clockwise around the table. */
export type Seat = number;

export interface PlayerState {
  id: PlayerId;
  seat: Seat;
  /** Kept in canonical (ascending card id) order so states serialize identically. */
  hand: CardId[];
  /** The `step` at which this player ran out. Finish order decides nothing but bragging rights — and who is not the durak. */
  outAtStep: number | null;
}

export interface TableSlot {
  attack: CardId;
  defence: CardId | null;
}

/**
 * Only two phases.
 *
 * Durak's "phases" are not sequential — attackers throw in *while* the defender
 * is still thinking. Encoding that as states produces a combinatorial mess, so
 * everything else is derived on demand by `eligibleAttackers`, `actorsToAct`
 * and `boutIsResolvable`.
 */
export type Phase = 'bout' | 'finished';

export interface GameResult {
  /** The loser. `null` means a draw. */
  durak: PlayerId | null;
  /** Finish order, first one out first. Excludes the durak. */
  order: PlayerId[];
  /**
   * `played_out` — somebody was left holding cards, or everyone emptied at once.
   * `stalemate` — the position was circulating with no progress; see
   * `MAX_BOUTS_WITHOUT_PROGRESS`.
   */
  reason: 'played_out' | 'stalemate';
  /** In a 2v2 game, the side that was left holding cards. */
  loserTeam: 0 | 1 | null;
}

/**
 * Bouts allowed to pass without a single card reaching the discard and without
 * the deck shrinking.
 *
 * Durak can genuinely cycle: three players who each cannot beat the next one
 * pass a card round the table forever, and identical positions recur. Humans
 * break it by playing differently; deterministic bots do not, and a server room
 * would hang. Termination therefore has to be a rule, not a hope — any real
 * game reaches a discard within a couple of bouts, so this only ever fires on a
 * position that was never going to resolve.
 */
export const MAX_BOUTS_WITHOUT_PROGRESS = 32;

export interface GameState {
  readonly config: RuleConfig;
  readonly trump: Suit;
  /** The face-up bottom card, until somebody draws it. */
  trumpCard: CardId | null;

  phase: Phase;
  /** Monotonic move counter. Doubles as the `seq` on the wire. */
  step: number;
  rng: RngState;

  /** Indexed by seat. */
  players: PlayerState[];
  /** `deck[0]` is the next card to draw; the last element is the trump card. */
  deck: CardId[];
  discard: CardId[];

  attacker: Seat;
  defender: Seat;
  table: TableSlot[];
  boutIndex: number;
  /** The defender has said "I take"; the bout is now in pile-on mode. */
  defenderTaking: boolean;
  /** Cards the defender held when this bout opened — the cap on attack cards. */
  defenderHandAtBoutStart: number;
  /** Per seat. Cleared on every table mutation: a new rank can re-enable someone. */
  passed: boolean[];
  /** Transfers already made this bout, so `allowChains: false` is enforceable. */
  transfersThisBout: number;
  /** Consecutive bouts in which neither the discard grew nor the deck shrank. */
  boutsWithoutProgress: number;

  result: GameResult | null;
}

// --- Seat helpers -----------------------------------------------------------

export const playerAt = (s: GameState, seat: Seat): PlayerState => {
  const p = s.players[seat];
  if (!p) throw new RangeError(`No seat ${seat}`);
  return p;
};

export const seatCount = (s: GameState): number => s.players.length;

export const isActive = (s: GameState, seat: Seat): boolean => playerAt(s, seat).outAtStep === null;

export const activeSeats = (s: GameState): Seat[] =>
  s.players.filter((p) => p.outAtStep === null).map((p) => p.seat);

export const nextSeat = (s: GameState, seat: Seat): Seat => (seat + 1) % seatCount(s);

/** Alternating seating, so a seat's team is simply its parity. */
export const teamAt = (s: GameState, seat: Seat): 0 | 1 | null =>
  s.config.teams === null ? null : ((seat % 2) as 0 | 1);

/**
 * First active seat at or clockwise after `seat` who is *not* on `avoid`'s team.
 *
 * Plain rotation is not enough once somebody is out: with two players gone the
 * next seat round can be your own partner, and a bout where partners face each
 * other has no attackers at all.
 */
export function nextOpponentFrom(s: GameState, seat: Seat, avoid: Seat): Seat {
  const n = seatCount(s);
  const team = teamAt(s, avoid);
  for (let i = 0; i < n; i++) {
    const candidate = (seat + i) % n;
    if (!isActive(s, candidate)) continue;
    if (team !== null && teamAt(s, candidate) === team) continue;
    return candidate;
  }
  return nextActiveFrom(s, seat);
}

/** First active seat at or clockwise after `seat`. Throws if nobody is active. */
export function nextActiveFrom(s: GameState, seat: Seat): Seat {
  const n = seatCount(s);
  for (let i = 0; i < n; i++) {
    const candidate = (seat + i) % n;
    if (isActive(s, candidate)) return candidate;
  }
  throw new Error('No active players remain');
}

// --- Construction -----------------------------------------------------------

export interface NewGameOptions {
  players: readonly PlayerId[];
  config: RuleConfig;
  seed: number | string;
}

export interface CreateGameResult {
  state: GameState;
  events: GameEvent[];
}

export function createGame(opts: NewGameOptions): CreateGameResult {
  const { players, config, seed } = opts;
  if (!isPlayable(config, players.length)) {
    const { errors } = validateConfig(config, players.length);
    throw new Error(`Unplayable configuration: ${errors.map((e) => e.code).join(', ')}`);
  }
  if (new Set(players).size !== players.length) throw new Error('Duplicate player ids');

  const rng = seedRng(seed);
  const deck = fullDeck(config.deckSize);
  shuffleInPlace(deck, rng);

  const hands: CardId[][] = players.map(() => []);
  for (let i = 0; i < config.handSize; i++) {
    for (const hand of hands) hand.push(deck.shift()!);
  }
  for (const hand of hands) hand.sort(compareCards);

  const trumpCard = deck[deck.length - 1]!;
  const trump = suitOf(trumpCard);

  const state: GameState = {
    config,
    trump,
    trumpCard,
    phase: 'bout',
    step: 0,
    rng,
    players: players.map((id, seat) => ({ id, seat, hand: hands[seat]!, outAtStep: null })),
    deck,
    discard: [],
    attacker: 0,
    defender: 0,
    table: [],
    boutIndex: 0,
    defenderTaking: false,
    defenderHandAtBoutStart: 0,
    passed: players.map(() => false),
    transfersThisBout: 0,
    boutsWithoutProgress: 0,
    result: null,
  };

  state.attacker = pickFirstAttacker(state);
  state.defender = nextSeat(state, state.attacker);
  state.defenderHandAtBoutStart = playerAt(state, state.defender).hand.length;

  const events: GameEvent[] = [{ k: 'dealt', hands: hands.map((h) => h.slice()), trumpCard }];
  return { state, events };
}

/**
 * Classic rule: whoever holds the lowest trump opens.
 *
 * The fallback matters more than it looks — with a 52-card deck and few
 * players, every trump can plausibly sit in the deck stub. Then the lowest card
 * overall opens, ties broken by suit order (♣ < ♦ < ♥ < ♠), which is exactly
 * ascending card id. Card ids are unique, so that is always decisive; there is
 * no third tier and therefore no hidden RNG dependency here.
 */
function pickFirstAttacker(s: GameState): Seat {
  if (s.config.firstAttacker === 'random') return nextInt(s.rng, seatCount(s));

  let bestSeat = 0;
  let bestTrump = Number.POSITIVE_INFINITY;
  let bestAny = Number.POSITIVE_INFINITY;
  let bestAnySeat = 0;

  for (const p of s.players) {
    for (const card of p.hand) {
      if (card < bestAny) {
        bestAny = card;
        bestAnySeat = p.seat;
      }
      if (suitOf(card) === s.trump && card < bestTrump) {
        bestTrump = card;
        bestSeat = p.seat;
      }
    }
  }
  return Number.isFinite(bestTrump) ? bestSeat : bestAnySeat;
}

export function cloneState(s: GameState): GameState {
  return {
    config: s.config,
    trump: s.trump,
    trumpCard: s.trumpCard,
    phase: s.phase,
    step: s.step,
    rng: cloneRng(s.rng),
    players: s.players.map((p) => ({
      id: p.id,
      seat: p.seat,
      hand: p.hand.slice(),
      outAtStep: p.outAtStep,
    })),
    deck: s.deck.slice(),
    discard: s.discard.slice(),
    attacker: s.attacker,
    defender: s.defender,
    table: s.table.map((t) => ({ attack: t.attack, defence: t.defence })),
    boutIndex: s.boutIndex,
    defenderTaking: s.defenderTaking,
    defenderHandAtBoutStart: s.defenderHandAtBoutStart,
    passed: s.passed.slice(),
    transfersThisBout: s.transfersThisBout,
    boutsWithoutProgress: s.boutsWithoutProgress,
    result: s.result ? { ...s.result, order: s.result.order.slice() } : null,
  };
}

/** Every card currently on the table, attacks and defences alike. */
export function tableCards(s: Pick<GameState, 'table'>): CardId[] {
  const out: CardId[] = [];
  for (const slot of s.table) {
    out.push(slot.attack);
    if (slot.defence !== null) out.push(slot.defence);
  }
  return out;
}
