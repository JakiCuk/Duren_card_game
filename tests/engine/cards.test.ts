import { describe, expect, it } from 'vitest';
import {
  beats,
  cardCode,
  deckSizeOf,
  fullDeck,
  makeCard,
  parseCardCode,
  rankOf,
  suitOf,
  SUITS,
  type CardId,
} from '../../src/engine/index.js';

/**
 * Deliberately written from the prose rule rather than from the implementation,
 * so that the exhaustive comparison below is a real second opinion.
 */
function referenceBeats(defence: CardId, attack: CardId, trump: number): boolean {
  const defenceIsTrump = suitOf(defence) === trump;
  const attackIsTrump = suitOf(attack) === trump;
  if (defenceIsTrump && attackIsTrump) return rankOf(defence) > rankOf(attack);
  if (defenceIsTrump) return true;
  if (attackIsTrump) return false;
  if (suitOf(defence) !== suitOf(attack)) return false;
  return rankOf(defence) > rankOf(attack);
}

describe('card encoding', () => {
  it('round-trips every card through its two-character code', () => {
    for (const card of fullDeck(52)) {
      expect(parseCardCode(cardCode(card))).toBe(card);
    }
  });

  it('packs rank and suit without collisions', () => {
    const seen = new Set<CardId>();
    for (let r = 0; r <= 12; r++) {
      for (const s of SUITS) {
        const c = makeCard(r, s);
        expect(rankOf(c)).toBe(r);
        expect(suitOf(c)).toBe(s);
        expect(seen.has(c)).toBe(false);
        seen.add(c);
      }
    }
  });

  it('rejects malformed codes instead of silently guessing', () => {
    for (const bad of ['', '1C', 'AX', 'AAS', 'A']) {
      expect(() => parseCardCode(bad)).toThrow();
    }
  });

  it('builds decks of the right size, 36 being a subset of 52', () => {
    expect(fullDeck(36)).toHaveLength(36);
    expect(fullDeck(52)).toHaveLength(52);
    expect(deckSizeOf(36)).toBe(36);
    expect(deckSizeOf(52)).toBe(52);
    const fifty2 = new Set(fullDeck(52));
    for (const c of fullDeck(36)) expect(fifty2.has(c)).toBe(true);
    for (const c of fullDeck(36)) expect(rankOf(c)).toBeGreaterThanOrEqual(4);
  });
});

describe('beats()', () => {
  it('agrees with an independent implementation on all 52 x 52 x 4 combinations', () => {
    const deck = fullDeck(52);
    let checked = 0;
    for (const trump of SUITS) {
      for (const attack of deck) {
        for (const defence of deck) {
          if (attack === defence) continue;
          expect(beats(defence, attack, trump), `${cardCode(defence)} vs ${cardCode(attack)} trump ${trump}`).toBe(
            referenceBeats(defence, attack, trump),
          );
          checked++;
        }
      }
    }
    expect(checked).toBe(52 * 51 * 4);
  });

  it('states the rules that matter, explicitly', () => {
    const trump = suitOf(parseCardCode('2S'));
    expect(beats(parseCardCode('8H'), parseCardCode('7H'), trump)).toBe(true); // higher, same suit
    expect(beats(parseCardCode('7H'), parseCardCode('8H'), trump)).toBe(false); // lower, same suit
    expect(beats(parseCardCode('AH'), parseCardCode('6D'), trump)).toBe(false); // wrong suit, no trump
    expect(beats(parseCardCode('6S'), parseCardCode('AH'), trump)).toBe(true); // any trump beats any plain
    expect(beats(parseCardCode('AH'), parseCardCode('6S'), trump)).toBe(false); // plain never beats a trump
    expect(beats(parseCardCode('7S'), parseCardCode('6S'), trump)).toBe(true); // higher trump
    expect(beats(parseCardCode('6S'), parseCardCode('7S'), trump)).toBe(false); // lower trump
  });
});
