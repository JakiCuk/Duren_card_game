import { cardCode, type GameEvent, type PublicEvent } from '../../engine/index.js';
import type { Translate } from '../i18n/index.js';

const list = (cards: readonly number[]): string => cards.map(cardCode).join(' ');

/**
 * One line per event, for the local game where the full record is available.
 *
 * Returns `null` for events that should not be shown at all — a forced pass is
 * engine bookkeeping, and printing it would leak that the player held no
 * matching rank.
 */
export function describeEvent(
  e: GameEvent,
  t: Translate,
  name: (seat: number) => string,
): string | null {
  switch (e.k) {
    case 'dealt':
      return t('log.dealt', { card: cardCode(e.trumpCard) });
    case 'attack':
      return t(e.throwIn ? 'log.throwIn' : 'log.attack', {
        name: name(e.seat),
        card: cardCode(e.card),
      });
    case 'defend':
      return t('log.defend', { name: name(e.seat), card: cardCode(e.card) });
    case 'transfer':
      return t(e.revealed ? 'log.transferReveal' : 'log.transfer', {
        name: name(e.seat),
        card: cardCode(e.card),
        target: name(e.to),
      });
    case 'takeDeclared':
      return t('log.takeDeclared', { name: name(e.seat) });
    case 'take':
      return t('log.take', { name: name(e.seat), cards: list(e.cards) });
    case 'pass':
      return e.auto ? null : t('log.pass', { name: name(e.seat) });
    case 'bito':
      return t('log.bito', { cards: list(e.cards) });
    case 'draw':
      return t('log.draw', { name: name(e.seat), count: e.cards.length });
    case 'trumpTaken':
      return t('log.trumpTaken', { name: name(e.seat), card: cardCode(e.card) });
    case 'out':
      return t('log.out', { name: name(e.seat) });
    case 'gameOver':
      if (e.result.reason === 'stalemate') return t('log.stalemate');
      return e.result.durak === null
        ? t('log.drawGame')
        : t('log.durak', { name: e.result.durak });
  }
}

/**
 * The same log for the redacted events the server sends.
 *
 * Kept separate rather than unified: the public stream is a genuinely different
 * type — a draw carries a count instead of cards, and a deal carries only your
 * own hand.
 */
export function describePublicEvent(
  e: PublicEvent,
  t: Translate,
  name: (seat: number) => string,
): string | null {
  switch (e.k) {
    case 'dealt':
      return t('log.dealt', { card: cardCode(e.trumpCard) });
    case 'attack':
      return t(e.throwIn ? 'log.throwIn' : 'log.attack', {
        name: name(e.seat),
        card: cardCode(e.card),
      });
    case 'defend':
      return t('log.defend', { name: name(e.seat), card: cardCode(e.card) });
    case 'transfer':
      return t(e.revealed ? 'log.transferReveal' : 'log.transfer', {
        name: name(e.seat),
        card: cardCode(e.card),
        target: name(e.to),
      });
    case 'takeDeclared':
      return t('log.takeDeclared', { name: name(e.seat) });
    case 'take':
      return t('log.take', { name: name(e.seat), cards: list(e.cards) });
    case 'pass':
      return t('log.pass', { name: name(e.seat) });
    case 'bito':
      return t('log.bito', { cards: list(e.cards) });
    case 'draw':
      return t('log.draw', { name: name(e.seat), count: e.count });
    case 'trumpTaken':
      return t('log.trumpTaken', { name: name(e.seat), card: cardCode(e.card) });
    case 'out':
      return t('log.out', { name: name(e.seat) });
    case 'gameOver':
      if (e.result.reason === 'stalemate') return t('log.stalemate');
      return e.result.durak === null
        ? t('log.drawGame')
        : t('log.durak', { name: e.result.durak });
  }
}
