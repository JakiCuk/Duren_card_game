import { cardCode, type GameEvent } from '../../engine/index.js';

const list = (cards: readonly number[]): string => cards.map(cardCode).join(' ');

/**
 * Human-readable line per event, for the hot-seat log. Becomes translation keys
 * once i18n lands; today it is deliberately plain so the engine's behaviour is
 * easy to watch while playing.
 */
export function describeEvent(e: GameEvent, name: (seat: number) => string): string | null {
  switch (e.k) {
    case 'dealt':
      return `Rozdané. Tromfová karta: ${cardCode(e.trumpCard)}.`;
    case 'attack':
      return `${name(e.seat)} ${e.throwIn ? 'prihadzuje' : 'útočí'} ${cardCode(e.card)}.`;
    case 'defend':
      return `${name(e.seat)} zbíja kartou ${cardCode(e.card)}.`;
    case 'takeDeclared':
      return `${name(e.seat)} berie.`;
    case 'take':
      return `${name(e.seat)} si berie ${list(e.cards)}.`;
    case 'pass':
      // Forced passes are engine bookkeeping, not a decision worth logging —
      // and showing them would leak that the player held no matching rank.
      return e.auto ? null : `${name(e.seat)} pasuje.`;
    case 'bito':
      return `Bito: ${list(e.cards)}.`;
    case 'draw':
      return `${name(e.seat)} dobral ${e.cards.length} kariet.`;
    case 'trumpTaken':
      return `${name(e.seat)} berie tromfovú kartu ${cardCode(e.card)} — balík je prázdny.`;
    case 'out':
      return `${name(e.seat)} sa zbavil kariet.`;
    case 'gameOver':
      return e.result.durak === null ? 'Remíza — nikto nie je durak.' : `Durak: ${e.result.durak}.`;
  }
}
