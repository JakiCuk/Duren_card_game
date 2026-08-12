import {
  beats,
  rankOf,
  suitOf,
  type CardId,
  type PlayerView,
  type PublicEvent,
  type Seat,
} from '../engine/index.js';
import type { CountingMemory } from './counting.js';

/** The deck is modelled as a holder too: cards go there, and come back. */
export const DECK: Seat = -1;

/**
 * Multiplicative evidence about who holds what, per (holder, card).
 *
 * Level 3 knows what is *possible*. Level 4 keeps track of what is *likely*,
 * from the things players choose not to do: a defender who took rather than
 * beat a seven probably had nothing that beats a seven, and a player who
 * declined to throw in a nine probably has no nine.
 *
 * Nothing here is certainty — the hard facts live in `CountingMemory` and are
 * applied on top.
 */
export class Belief {
  /** `evidence[holderIndex * 52 + card]`, prior 1. */
  private evidence = new Map<string, number>();
  private tableRanks = new Set<number>();
  private lastAttack: CardId | null = null;
  private handCounts = new Map<Seat, number>();

  constructor(private readonly mySeat: Seat) {}

  private key(holder: Seat, card: CardId): string {
    return `${holder}:${card}`;
  }

  private scale(holder: Seat, card: CardId, factor: number): void {
    const k = this.key(holder, card);
    this.evidence.set(k, (this.evidence.get(k) ?? 1) * factor);
  }

  private weightOf(holder: Seat, card: CardId): number {
    return this.evidence.get(this.key(holder, card)) ?? 1;
  }

  /**
   * Folds observed behaviour into the evidence.
   *
   * Read the factors as "how much less likely this becomes": 0.25 is a strong
   * hint, 0.6 a weak one. They are deliberately soft — a good player takes with
   * a beater in hand precisely so that this inference is wrong.
   */
  observe(events: readonly PublicEvent[], view: PlayerView): void {
    for (const p of view.players) this.handCounts.set(p.seat, p.handCount);

    for (const e of events) {
      switch (e.k) {
        case 'attack':
          this.tableRanks.add(rankOf(e.card));
          this.lastAttack = e.card;
          break;

        case 'defend':
          this.tableRanks.add(rankOf(e.card));
          this.hadNothingCheaper(e.seat, e.card, view);
          break;

        case 'transfer':
          this.tableRanks.add(rankOf(e.card));
          break;

        case 'takeDeclared':
          this.tookInsteadOfBeating(e.seat, view);
          break;

        case 'pass':
          this.declinedToThrowIn(e.seat, view);
          break;

        case 'draw':
          // Fresh cards are unconstrained by anything we inferred before, so
          // the evidence has to decay towards the prior. Skipping this is how
          // an opponent model becomes confidently wrong within three bouts.
          this.decay(e.seat, e.count);
          break;

        case 'bito':
        case 'take':
          this.tableRanks.clear();
          this.lastAttack = null;
          break;

        case 'dealt':
        case 'trumpTaken':
        case 'out':
        case 'gameOver':
          break;
      }
    }
  }

  /** They conceded rather than beat the attack: they probably could not. */
  private tookInsteadOfBeating(seat: Seat, view: PlayerView): void {
    if (seat === this.mySeat || this.lastAttack === null) return;
    // Under "must beat if you can", taking is not a choice — it is proof.
    const factor = view.config.defenderMustBeatAll ? 0 : 0.25;
    for (const card of possibleCards()) {
      if (beats(card, this.lastAttack, view.trump)) this.scale(seat, card, factor);
    }
  }

  /** A trump spent where a plain card would have done says the plain card was missing. */
  private hadNothingCheaper(seat: Seat, played: CardId, view: PlayerView): void {
    if (seat === this.mySeat || this.lastAttack === null) return;
    if (suitOf(played) !== view.trump) return;
    if (suitOf(this.lastAttack) === view.trump) return;
    for (const card of possibleCards()) {
      if (suitOf(card) === suitOf(this.lastAttack) && rankOf(card) > rankOf(this.lastAttack)) {
        this.scale(seat, card, 0.35);
      }
    }
  }

  /** Passing on ranks that are sitting on the table suggests they hold none. */
  private declinedToThrowIn(seat: Seat, view: PlayerView): void {
    if (seat === this.mySeat || this.tableRanks.size === 0) return;
    // With the deck gone there is no "saving it for later"; the inference is
    // much closer to a certainty.
    const factor = view.deckCount === 0 ? 0.15 : 0.6;
    for (const card of possibleCards()) {
      if (this.tableRanks.has(rankOf(card))) this.scale(seat, card, factor);
    }
  }

  /** After drawing `count` of `handCount` cards, that fraction is unconstrained. */
  private decay(seat: Seat, count: number): void {
    const handCount = this.handCounts.get(seat) ?? 0;
    if (seat === this.mySeat || count <= 0 || handCount <= 0) return;
    const keep = Math.max(1 - count / handCount, 0);
    for (const card of possibleCards()) {
      const k = this.key(seat, card);
      const current = this.evidence.get(k);
      if (current === undefined) continue;
      this.evidence.set(k, 1 + (current - 1) * keep);
    }
  }

  /**
   * Marginal probabilities that each holder has each unknown card.
   *
   * Fitted by iterative proportional scaling (Sinkhorn): rows are scaled so a
   * holder's probabilities sum to the number of cards they hold, columns so
   * each card is somewhere exactly once. A dozen passes is plenty — this is a
   * decent marginal approximation, not an exact posterior over deals, and
   * pretending otherwise would be false precision.
   */
  fit(view: PlayerView, memory: CountingMemory): BeliefTable {
    const unknown = memory.unknownPool(view);
    const holders: Seat[] = view.players
      .filter((p) => p.seat !== this.mySeat && !p.out)
      .map((p) => p.seat);
    const capacity = new Map<Seat, number>();
    for (const seat of holders) capacity.set(seat, memory.unknownHandSize(view, seat));

    const deckCapacity = Math.max(view.deckCount - (view.trumpCard === null ? 0 : 1), 0);
    if (deckCapacity > 0) {
      holders.push(DECK);
      capacity.set(DECK, deckCapacity);
    }

    const w = new Map<string, number>();
    for (const seat of holders) {
      for (const card of unknown) {
        // Nothing is inferred about the deck: cards fall into it at random.
        w.set(this.key(seat, card), seat === DECK ? 1 : this.weightOf(seat, card));
      }
    }

    for (let pass = 0; pass < 12; pass++) {
      for (const seat of holders) {
        const want = capacity.get(seat) ?? 0;
        let sum = 0;
        for (const card of unknown) sum += w.get(this.key(seat, card)) ?? 0;
        if (sum <= 0) continue;
        const factor = want / sum;
        for (const card of unknown) {
          w.set(this.key(seat, card), (w.get(this.key(seat, card)) ?? 0) * factor);
        }
      }
      for (const card of unknown) {
        let sum = 0;
        for (const seat of holders) sum += w.get(this.key(seat, card)) ?? 0;
        if (sum <= 0) continue;
        const factor = 1 / sum;
        for (const seat of holders) {
          w.set(this.key(seat, card), (w.get(this.key(seat, card)) ?? 0) * factor);
        }
      }
    }

    return new BeliefTable(holders, unknown, capacity, w, memory, view, this.mySeat);
  }
}

/** A fitted snapshot: probabilities plus the hard facts they sit on top of. */
export class BeliefTable {
  constructor(
    readonly holders: readonly Seat[],
    readonly unknown: readonly CardId[],
    readonly capacity: ReadonlyMap<Seat, number>,
    private readonly w: ReadonlyMap<string, number>,
    private readonly memory: CountingMemory,
    private readonly view: PlayerView,
    private readonly mySeat: Seat,
  ) {}

  probability(holder: Seat, card: CardId): number {
    if (holder !== DECK && this.memory.cardsKnownIn(holder).includes(card)) return 1;
    return Math.min(Math.max(this.w.get(`${holder}:${card}`) ?? 0, 0), 1);
  }

  /** Chance that `seat` can answer `card`, hard knowledge included. */
  canBeat(seat: Seat, card: CardId): number {
    if (this.memory.cardsKnownIn(seat).some((c) => beats(c, card, this.view.trump))) return 1;
    let none = 1;
    for (const candidate of this.unknown) {
      if (!beats(candidate, card, this.view.trump)) continue;
      none *= 1 - this.probability(seat, candidate);
    }
    return 1 - none;
  }

  /** Chance that `seat` holds any card of this rank — the perevodnoy question. */
  holdsRank(seat: Seat, rank: number): number {
    if (this.memory.cardsKnownIn(seat).some((c) => rankOf(c) === rank)) return 1;
    let none = 1;
    for (const candidate of this.unknown) {
      if (rankOf(candidate) === rank) none *= 1 - this.probability(seat, candidate);
    }
    return 1 - none;
  }

  get opponents(): Seat[] {
    return this.holders.filter((h) => h !== DECK && h !== this.mySeat);
  }
}

/** All 52 ids; filtering by deck size is the caller's job and rarely matters. */
function possibleCards(): readonly CardId[] {
  return ALL_CARDS;
}

const ALL_CARDS: CardId[] = Array.from({ length: 52 }, (_, i) => i);
