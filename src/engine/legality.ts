import type { RuleConfig } from '../shared/rules.js';
import type { CardId, Rank, Suit } from './cards.js';
import { beats, rankOf } from './cards.js';
import type { Move } from './moves.js';
import type { GameState, Seat, TableSlot } from './state.js';

export interface SeatInfo {
  seat: Seat;
  handCount: number;
  out: boolean;
}

/**
 * Everything the rules need in order to decide what is legal.
 *
 * Both the authoritative `GameState` (which knows every hand) and a redacted
 * `PlayerView` (which knows only its own) implement this. That is deliberate:
 * the browser and the server then run *the same* legality code, so client-side
 * affordances and server-side validation cannot drift apart.
 */
export interface LegalityCtx {
  readonly config: RuleConfig;
  readonly trump: Suit;
  readonly table: readonly TableSlot[];
  readonly attackerSeat: Seat;
  readonly defenderSeat: Seat;
  readonly defenderTaking: boolean;
  readonly defenderHandAtBoutStart: number;
  readonly boutIndex: number;
  readonly passed: readonly boolean[];
  readonly seats: readonly SeatInfo[];
  readonly finished: boolean;
  /** The seat's cards, or `null` when they are hidden from this viewer. */
  handOf(seat: Seat): readonly CardId[] | null;
}

export function ctxOf(s: GameState): LegalityCtx {
  return {
    config: s.config,
    trump: s.trump,
    table: s.table,
    attackerSeat: s.attacker,
    defenderSeat: s.defender,
    defenderTaking: s.defenderTaking,
    defenderHandAtBoutStart: s.defenderHandAtBoutStart,
    boutIndex: s.boutIndex,
    passed: s.passed,
    seats: s.players.map((p) => ({ seat: p.seat, handCount: p.hand.length, out: p.outAtStep !== null })),
    finished: s.phase === 'finished',
    handOf: (seat) => s.players[seat]?.hand ?? null,
  };
}

const seatInfo = (ctx: LegalityCtx, seat: Seat): SeatInfo | undefined => ctx.seats[seat];

/**
 * Who may attack this bout.
 *
 * Currently every player except the defender, which is also what the
 * "neighbours only" house rule collapses to at two and three players. Scoping
 * and the teammate ban arrive with the full rule matrix.
 */
export function eligibleAttackers(ctx: LegalityCtx): Seat[] {
  const out: Seat[] = [];
  for (const info of ctx.seats) {
    if (info.seat === ctx.defenderSeat || info.out || info.handCount === 0) continue;
    out.push(info.seat);
  }
  return out;
}

export const isEligibleAttacker = (ctx: LegalityCtx, seat: Seat): boolean => {
  const info = seatInfo(ctx, seat);
  return info !== undefined && seat !== ctx.defenderSeat && !info.out && info.handCount > 0;
};

/**
 * Maximum attack cards this bout.
 *
 * The defender held `defenderHandAtBoutStart` cards when the bout opened and
 * can therefore never beat more than that many attacks — which is the classic
 * rule, and also why an "unlimited" house rule is a polite fiction. The hard
 * `maxTableSlots` ceiling exists so that no configuration can produce a table
 * the UI and the bot search cannot cope with.
 */
export function attackCap(ctx: LegalityCtx): number {
  const firstBout =
    ctx.boutIndex === 0 && ctx.config.firstBoutCapFive
      ? ctx.config.handSize - 1
      : Number.POSITIVE_INFINITY;
  return Math.min(ctx.config.maxTableSlots, ctx.defenderHandAtBoutStart, firstBout);
}

/** Ranks already on the table — attack *and* defence cards both enable throw-ins. */
export function tableRanks(ctx: LegalityCtx): Set<Rank> {
  const ranks = new Set<Rank>();
  for (const slot of ctx.table) {
    ranks.add(rankOf(slot.attack));
    if (slot.defence !== null) ranks.add(rankOf(slot.defence));
  }
  return ranks;
}

export const hasUnbeaten = (ctx: LegalityCtx): boolean => ctx.table.some((t) => t.defence === null);

function canAttackAtAll(ctx: LegalityCtx, seat: Seat): boolean {
  if (ctx.finished) return false;
  if (!isEligibleAttacker(ctx, seat)) return false;
  if (ctx.passed[seat] === true) return false;
  if (ctx.table.length === 0) return seat === ctx.attackerSeat && !ctx.defenderTaking;
  if (ctx.defenderTaking && !ctx.config.throwInAfterTake) return false;
  return ctx.table.length < attackCap(ctx);
}

/** Cards `seat` could legally play as an attack or throw-in right now. */
export function attackableCards(ctx: LegalityCtx, seat: Seat): CardId[] {
  if (!canAttackAtAll(ctx, seat)) return [];
  const hand = ctx.handOf(seat);
  if (hand === null) throw new Error(`Hand of seat ${seat} is hidden from this context`);
  if (ctx.table.length === 0) return [...hand];
  const ranks = tableRanks(ctx);
  return hand.filter((c) => ranks.has(rankOf(c)));
}

/**
 * Cheap "could this player throw in?" without materializing the card list.
 * Used by the auto-pass rule after every table mutation.
 */
export function hasLegalAttack(ctx: LegalityCtx, seat: Seat): boolean {
  if (!canAttackAtAll(ctx, seat)) return false;
  const hand = ctx.handOf(seat);
  if (hand === null) throw new Error(`Hand of seat ${seat} is hidden from this context`);
  if (ctx.table.length === 0) return hand.length > 0;
  const ranks = tableRanks(ctx);
  return hand.some((c) => ranks.has(rankOf(c)));
}

function canDefend(ctx: LegalityCtx, seat: Seat): boolean {
  return !ctx.finished && seat === ctx.defenderSeat && !ctx.defenderTaking && hasUnbeaten(ctx);
}

export function legalMoves(ctx: LegalityCtx, seat: Seat): Move[] {
  if (ctx.finished) return [];
  if (ctx.handOf(seat) === null) throw new Error(`Cannot enumerate moves for hidden seat ${seat}`);
  const moves: Move[] = [];

  if (seat === ctx.defenderSeat) {
    if (canDefend(ctx, seat)) {
      const hand = ctx.handOf(seat)!;
      for (let slot = 0; slot < ctx.table.length; slot++) {
        const target = ctx.table[slot]!;
        if (target.defence !== null) continue;
        for (const card of hand) {
          if (beats(card, target.attack, ctx.trump)) moves.push({ t: 'DEFEND', seat, card, slot });
        }
      }
      moves.push({ t: 'TAKE', seat });
    }
    return moves;
  }

  for (const card of attackableCards(ctx, seat)) moves.push({ t: 'ATTACK', seat, card });
  if (ctx.table.length > 0 && isEligibleAttacker(ctx, seat) && ctx.passed[seat] !== true) {
    moves.push({ t: 'PASS', seat });
  }
  return moves;
}

export function isLegal(ctx: LegalityCtx, m: Move): boolean {
  if (ctx.finished) return false;
  const info = seatInfo(ctx, m.seat);
  if (info === undefined || info.out) return false;
  const hand = ctx.handOf(m.seat);

  switch (m.t) {
    case 'ATTACK': {
      if (!canAttackAtAll(ctx, m.seat)) return false;
      if (hand === null || !hand.includes(m.card)) return false;
      if (ctx.table.length === 0) return true;
      return tableRanks(ctx).has(rankOf(m.card));
    }
    case 'DEFEND': {
      if (!canDefend(ctx, m.seat)) return false;
      if (hand === null || !hand.includes(m.card)) return false;
      const slot = ctx.table[m.slot];
      if (slot === undefined || slot.defence !== null) return false;
      return beats(m.card, slot.attack, ctx.trump);
    }
    case 'TAKE':
      return canDefend(ctx, m.seat);
    case 'PASS':
      return ctx.table.length > 0 && isEligibleAttacker(ctx, m.seat) && ctx.passed[m.seat] !== true;
  }
}

/**
 * Seats that can act right now. More than one is normal and correct — while the
 * defender thinks, any eligible attacker may throw in.
 */
export function actorsToAct(s: GameState): Seat[] {
  if (s.phase === 'finished') return [];
  const ctx = ctxOf(s);
  return s.players.filter((p) => p.outAtStep === null && legalMoves(ctx, p.seat).length > 0).map((p) => p.seat);
}

/**
 * The bout is over once every eligible attacker has passed and the table has
 * been settled one way or the other. Resolution happens inside the very
 * `applyMove` call that satisfies this, so the engine never sits in a state
 * that needs an external tick.
 */
export function boutIsResolvable(ctx: LegalityCtx): boolean {
  if (ctx.table.length === 0) return false;
  for (const seat of eligibleAttackers(ctx)) {
    if (ctx.passed[seat] !== true) return false;
  }
  return ctx.defenderTaking || !hasUnbeaten(ctx);
}
