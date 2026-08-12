import {
  beats,
  fullDeck,
  rankOf,
  suitOf,
  type CardId,
  type PlayerView,
  type PublicEvent,
  type Rank,
  type Seat,
  type Suit,
} from '../engine/index.js';

/**
 * Everything a player could work out by watching the table.
 *
 * The discard pile is public information — every card in it was shown face up —
 * but the wire only carries its size, so a counting bot has to rebuild it from
 * the event log. That constraint is deliberate: it keeps "counts cards" and
 * "sees the deck" on opposite sides of a line the type system enforces.
 *
 * The model is simply "where is each card?". A card is *located* when we know
 * that; everything else is the unknown pool, which is exactly the opponents'
 * unnamed cards plus whatever is left in the deck.
 */
export class CountingMemory {
  /** Cards that have been beaten and set aside. Public, but not on the wire. */
  private readonly discarded = new Set<CardId>();
  /**
   * Exact knowledge, not a guess: everyone watched these specific cards go into
   * that hand when the player took the table. In a long game this can account
   * for most of an opponent's hand.
   */
  readonly knownHeld = new Map<Seat, Set<CardId>>();

  private mySeat: Seat;

  constructor(seat: Seat) {
    this.mySeat = seat;
  }

  observe(events: readonly PublicEvent[], view: PlayerView): void {
    this.mySeat = view.you?.seat ?? this.mySeat;

    for (const e of events) {
      switch (e.k) {
        case 'attack':
        case 'defend':
          // The card left that hand and is now face up on the table.
          this.forget(e.seat, e.card);
          break;

        case 'transfer':
          // A revealed trump stays in hand — and now everybody knows it is there.
          if (e.revealed) this.remember(e.seat, e.card);
          else this.forget(e.seat, e.card);
          break;

        case 'take':
          for (const c of e.cards) this.remember(e.seat, c);
          break;

        case 'bito':
          for (const c of e.cards) this.discarded.add(c);
          break;

        case 'trumpTaken':
          this.remember(e.seat, e.card);
          break;

        case 'dealt':
        case 'draw':
        case 'takeDeclared':
        case 'pass':
        case 'out':
        case 'gameOver':
          break;
      }
    }
  }

  private remember(seat: Seat, card: CardId): void {
    if (seat === this.mySeat) return;
    let set = this.knownHeld.get(seat);
    if (!set) {
      set = new Set();
      this.knownHeld.set(seat, set);
    }
    set.add(card);
  }

  private forget(seat: Seat, card: CardId): void {
    this.knownHeld.get(seat)?.delete(card);
  }

  /** Cards whose position we know: ours, on the table, discarded, or named in a hand. */
  private located(view: PlayerView): Set<CardId> {
    const known = new Set<CardId>(this.discarded);
    for (const c of view.you?.hand ?? []) known.add(c);
    for (const slot of view.table) {
      known.add(slot.attack);
      if (slot.defence !== null) known.add(slot.defence);
    }
    for (const held of this.knownHeld.values()) for (const c of held) known.add(c);
    // The face-up bottom card is in the deck, and we know which card it is.
    if (view.trumpCard !== null) known.add(view.trumpCard);
    return known;
  }

  /** Opponents' unnamed cards plus the rest of the deck. */
  unknownPool(view: PlayerView): CardId[] {
    const known = this.located(view);
    return fullDeck(view.config.deckSize).filter((c) => !known.has(c));
  }

  /** How many of a player's cards we cannot name. */
  unknownHandSize(view: PlayerView, seat: Seat): number {
    const player = view.players.find((p) => p.seat === seat);
    if (!player) return 0;
    return Math.max(player.handCount - (this.knownHeld.get(seat)?.size ?? 0), 0);
  }

  cardsKnownIn(seat: Seat): CardId[] {
    return [...(this.knownHeld.get(seat) ?? [])];
  }

  /** Trumps nobody has located yet, including any still in the deck. */
  trumpsUnseen(view: PlayerView): number {
    return this.unknownPool(view).filter((c) => suitOf(c) === view.trump).length;
  }

  /** The best card of a suit still unaccounted for. `-1` when all are placed. */
  highestUnseen(view: PlayerView, suit: Suit): Rank {
    let best = -1;
    for (const c of this.unknownPool(view)) {
      if (suitOf(c) === suit && rankOf(c) > best) best = rankOf(c);
    }
    return best;
  }

  /**
   * True when nothing an opponent could be holding beats this card.
   *
   * The single most valuable endgame fact in Durak: a provably unbeatable card
   * held back wins the last bout outright.
   */
  isUnbeatable(view: PlayerView, card: CardId): boolean {
    const trump = view.trump;
    if (this.unknownPool(view).some((c) => beats(c, card, trump))) return false;
    for (const [seat, held] of this.knownHeld) {
      if (seat === this.mySeat) continue;
      for (const c of held) if (beats(c, card, trump)) return false;
    }
    return true;
  }

  /** Hidden cards that would beat `card`, ignoring who might hold them. */
  beatersLeft(view: PlayerView, card: CardId): CardId[] {
    return this.unknownPool(view).filter((c) => beats(c, card, view.trump));
  }

  /**
   * Heads-up with an empty deck, the unknown pool *is* the opponent's hand — no
   * sampling and no probability, just arithmetic. That is what makes an exact
   * endgame solver possible rather than a search over guesses.
   */
  opponentHandIsKnown(view: PlayerView): boolean {
    return view.players.length === 2 && view.deckCount === 0;
  }

  /** The opponent's exact hand, when `opponentHandIsKnown` says there is one. */
  opponentHand(view: PlayerView, seat: Seat): CardId[] {
    return [...this.cardsKnownIn(seat), ...this.unknownPool(view)].sort((a, b) => a - b);
  }
}
