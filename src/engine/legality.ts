import type { RuleConfig } from '../shared/rules.js';
import type { CardId, Rank, Suit } from './cards.js';
import { beats, rankOf, suitOf } from './cards.js';
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
  readonly transfersThisBout: number;
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
    transfersThisBout: s.transfersThisBout,
    passed: s.passed,
    seats: s.players.map((p) => ({ seat: p.seat, handCount: p.hand.length, out: p.outAtStep !== null })),
    finished: s.phase === 'finished',
    handOf: (seat) => s.players[seat]?.hand ?? null,
  };
}

const seatInfo = (ctx: LegalityCtx, seat: Seat): SeatInfo | undefined => ctx.seats[seat];

/**
 * Which side a seat plays for, or `null` in a free-for-all.
 *
 * Alternating seating is the only supported arrangement, so the team is simply
 * the parity of the seat — which also means partners always sit opposite one
 * another and never adjacent.
 */
export const teamOf = (ctx: LegalityCtx, seat: Seat): 0 | 1 | null =>
  ctx.config.teams === null ? null : ((seat % 2) as 0 | 1);

export const sameTeam = (ctx: LegalityCtx, a: Seat, b: Seat): boolean => {
  const team = teamOf(ctx, a);
  return team !== null && team === teamOf(ctx, b);
};

const isIn = (ctx: LegalityCtx, seat: Seat): boolean => {
  const info = seatInfo(ctx, seat);
  return info !== undefined && !info.out;
};

/** First seat still in the game, walking in `step` direction from `from` exclusive. */
function walk(ctx: LegalityCtx, from: Seat, step: 1 | -1): Seat {
  const n = ctx.seats.length;
  for (let i = 1; i <= n; i++) {
    const seat = (((from + step * i) % n) + n) % n;
    if (isIn(ctx, seat)) return seat;
  }
  return from;
}

export const nextInPlay = (ctx: LegalityCtx, seat: Seat): Seat => walk(ctx, seat, 1);
export const prevInPlay = (ctx: LegalityCtx, seat: Seat): Seat => walk(ctx, seat, -1);

/**
 * Who may attack this bout.
 *
 * Under "neighbours only" that is the two players either side of the defender,
 * which is why the set has to be recomputed after a transfer: moving the
 * defence also moves the neighbours.
 */
export function eligibleAttackers(ctx: LegalityCtx): Seat[] {
  const canJoin =
    ctx.config.attackerScope === 'neighbours'
      ? new Set<Seat>([prevInPlay(ctx, ctx.defenderSeat), nextInPlay(ctx, ctx.defenderSeat)])
      : null;

  const out: Seat[] = [];
  for (const info of ctx.seats) {
    if (info.seat === ctx.defenderSeat || info.out || info.handCount === 0) continue;
    if (canJoin && !canJoin.has(info.seat)) continue;
    // You never attack your own partner, whatever the scope setting says.
    if (sameTeam(ctx, info.seat, ctx.defenderSeat)) continue;
    out.push(info.seat);
  }
  return out;
}

export const isEligibleAttacker = (ctx: LegalityCtx, seat: Seat): boolean =>
  eligibleAttackers(ctx).includes(seat);

/**
 * Maximum attack cards this bout.
 *
 * "Unlimited" is a polite fiction while the defender is defending: they can
 * never beat more cards than they held when the bout opened, so it and
 * "defender's hand" are the same rule. The difference only shows up *after* a
 * take, which is why that has its own setting.
 */
export function attackCap(ctx: LegalityCtx): number {
  const hard = ctx.config.maxTableSlots;

  if (ctx.defenderTaking) {
    switch (ctx.config.throwInAfterTakeCap) {
      case 'unlimited':
        return hard;
      case 'defenderHandAtBoutStart':
        return Math.min(hard, ctx.defenderHandAtBoutStart);
      case 'sameAsAttack':
        return Math.min(hard, capWith(ctx, ctx.defenderHandAtBoutStart));
    }
  }
  return Math.min(hard, capWith(ctx, ctx.defenderHandAtBoutStart));
}

/**
 * The cap that would apply if the defender held `defenderHand` cards when the
 * bout opened. Parameterised because a transfer replaces the defender, and the
 * new table size has to fit the *new* defender's cap — otherwise perevodnoy
 * quietly smuggles cards past a fixed limit.
 */
function capWith(ctx: LegalityCtx, defenderHand: number): number {
  const firstBout =
    ctx.boutIndex === 0 && ctx.config.firstBoutCapFive
      ? ctx.config.handSize - 1
      : Number.POSITIVE_INFINITY;

  const byRule =
    ctx.config.attackCap.kind === 'fixed'
      ? ctx.config.attackCap.n
      : // Both 'defenderHand' and 'unlimited' bottom out here: nobody beats
        // more cards than they hold.
        defenderHand;

  return Math.min(ctx.config.maxTableSlots, byRule, defenderHand, firstBout);
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
  const hand = requireHand(ctx, seat);
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
  const hand = requireHand(ctx, seat);
  if (ctx.table.length === 0) return hand.length > 0;
  const ranks = tableRanks(ctx);
  return hand.some((c) => ranks.has(rankOf(c)));
}

function requireHand(ctx: LegalityCtx, seat: Seat): readonly CardId[] {
  const hand = ctx.handOf(seat);
  if (hand === null) throw new Error(`Hand of seat ${seat} is hidden from this context`);
  return hand;
}

const canDefend = (ctx: LegalityCtx, seat: Seat): boolean =>
  !ctx.finished && seat === ctx.defenderSeat && !ctx.defenderTaking && hasUnbeaten(ctx);

/**
 * The single rank every attack on the table shares, or `null` when they differ
 * or anything has already been beaten. A transfer is only possible while the
 * whole table is one untouched rank.
 */
export function transferableRank(ctx: LegalityCtx): Rank | null {
  if (ctx.table.length === 0) return null;
  let rank: Rank | null = null;
  for (const slot of ctx.table) {
    if (slot.defence !== null) return null;
    const r = rankOf(slot.attack);
    if (rank === null) rank = r;
    else if (rank !== r) return null;
  }
  return rank;
}

/** Who would have to defend if the current defender transferred. */
export const transferTarget = (ctx: LegalityCtx): Seat => nextInPlay(ctx, ctx.defenderSeat);

export function transferableCards(ctx: LegalityCtx, seat: Seat): { card: CardId; reveal: boolean }[] {
  if (!ctx.config.transfer.enabled) return [];
  if (ctx.finished || seat !== ctx.defenderSeat || ctx.defenderTaking) return [];
  if (!ctx.config.transfer.allowChains && ctx.transfersThisBout > 0) return [];

  const rank = transferableRank(ctx);
  if (rank === null) return [];

  const target = transferTarget(ctx);
  if (target === seat) return [];
  // Handing the bout to your partner would be handing them the loss.
  if (sameTeam(ctx, target, seat)) return [];
  const targetInfo = seatInfo(ctx, target);
  if (targetInfo === undefined || targetInfo.out) return [];

  // After the transfer the cap is recomputed from the *new* defender's hand,
  // and the table has to fit inside it. Playing the card grows the table by
  // one; revealing a trump leaves it as it is.
  const capAfter = capWith(ctx, targetInfo.handCount);
  const canPlay = ctx.table.length + 1 <= capAfter;
  const canReveal = ctx.config.transfer.withTrumpReveal && ctx.table.length <= capAfter;

  const hand = requireHand(ctx, seat);
  const out: { card: CardId; reveal: boolean }[] = [];
  for (const card of hand) {
    if (rankOf(card) !== rank) continue;
    if (canPlay) out.push({ card, reveal: false });
    if (canReveal && suitOf(card) === ctx.trump) out.push({ card, reveal: true });
  }
  return out;
}

export function legalMoves(ctx: LegalityCtx, seat: Seat): Move[] {
  if (ctx.finished) return [];
  requireHand(ctx, seat);
  const moves: Move[] = [];

  if (seat === ctx.defenderSeat) {
    for (const { card, reveal } of transferableCards(ctx, seat)) {
      moves.push({ t: 'TRANSFER', seat, card, reveal });
    }
    if (canDefend(ctx, seat)) {
      const hand = requireHand(ctx, seat);
      for (let slot = 0; slot < ctx.table.length; slot++) {
        const target = ctx.table[slot]!;
        if (target.defence !== null) continue;
        for (const card of hand) {
          if (beats(card, target.attack, ctx.trump)) moves.push({ t: 'DEFEND', seat, card, slot });
        }
      }
      if (canTake(ctx, seat, moves)) moves.push({ t: 'TAKE', seat });
    }
    return moves;
  }

  for (const card of attackableCards(ctx, seat)) moves.push({ t: 'ATTACK', seat, card });
  if (ctx.table.length > 0 && isEligibleAttacker(ctx, seat) && ctx.passed[seat] !== true) {
    moves.push({ t: 'PASS', seat });
  }
  return moves;
}

/**
 * Under `defenderMustBeatAll`, taking stops being a decision and becomes what
 * happens when nothing else can. That turns a defender's move list into a
 * single forced move, and it upgrades "they took" from a hint into proof that
 * they held nothing — which is why counting bots get stronger under this rule.
 */
function canTake(ctx: LegalityCtx, seat: Seat, alreadyFound?: readonly Move[]): boolean {
  if (!canDefend(ctx, seat)) return false;
  if (!ctx.config.defenderMustBeatAll) return true;

  const others = alreadyFound ?? legalMovesForDefenderWithoutTake(ctx, seat);
  return !others.some((m) => m.t === 'DEFEND' || m.t === 'TRANSFER');
}

function legalMovesForDefenderWithoutTake(ctx: LegalityCtx, seat: Seat): Move[] {
  const moves: Move[] = [];
  for (const { card, reveal } of transferableCards(ctx, seat)) {
    moves.push({ t: 'TRANSFER', seat, card, reveal });
  }
  const hand = requireHand(ctx, seat);
  for (let slot = 0; slot < ctx.table.length; slot++) {
    const target = ctx.table[slot]!;
    if (target.defence !== null) continue;
    for (const card of hand) {
      if (beats(card, target.attack, ctx.trump)) moves.push({ t: 'DEFEND', seat, card, slot });
    }
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
    case 'TRANSFER':
      return transferableCards(ctx, m.seat).some((o) => o.card === m.card && o.reveal === m.reveal);
    case 'TAKE':
      return canTake(ctx, m.seat);
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
