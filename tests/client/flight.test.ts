import { describe, expect, it } from 'vitest';
import type { CSSProperties } from 'react';
import { planFlights, type Snapshot } from '../../src/client/game/Board.js';
import { parseCardCode, type Seat } from '../../src/engine/index.js';

/**
 * Chairs for a four-handed table, as the board would place them: seat 0 is the
 * viewer (no entry — the tray draws them), the rest ring the felt.
 */
const chairs = new Map<Seat, CSSProperties>([
  [1, { left: '88.0%', top: '45.0%' }],
  [2, { left: '50.0%', top: '15.0%' }],
  [3, { left: '12.0%', top: '45.0%' }],
]);

const card = parseCardCode;

const base = (over: Partial<Snapshot> = {}): Snapshot => ({
  table: [],
  taking: false,
  defender: 1,
  attacker: 0,
  deckCount: 12,
  trumpCard: card('6H'),
  hands: new Map<Seat, number>([
    [0, 6],
    [1, 6],
    [2, 6],
    [3, 6],
  ]),
  finished: false,
  ...over,
});

describe('what flies where when a bout ends', () => {
  const bout = [
    { attack: card('7C'), defence: card('9C') },
    { attack: card('8D'), defence: card('KD') },
  ];

  it('sends a beaten bout face up, out towards the discard', () => {
    const before = base({ table: bout, taking: false });
    const [phase] = planFlights(before, base(), chairs);

    expect(phase!.from).toBe('pile');
    expect(phase!.cards).toHaveLength(4);
    // Everybody saw these cards, so there is nothing to hide on the way out.
    expect(phase!.cards.every((c) => !c.faceDown && !c.flips)).toBe(true);
    expect(phase!.cards[0]!.target).toMatchObject({ '--tx': '26vw', '--ty': '-19vh' });
  });

  it('turns a taken bout over and sends it to the hand that took it', () => {
    const before = base({ table: bout, taking: true, defender: 2 });
    // Seat 2 took four cards; nobody drew, so the deck is untouched.
    const after = base({ hands: new Map(before.hands).set(2, 10) });
    const [phase] = planFlights(before, after, chairs);

    expect(phase!.cards).toHaveLength(4);
    expect(phase!.cards.every((c) => c.flips)).toBe(true);
    // Seat 2 sits at the top of the table, so the cards travel up.
    expect(phase!.cards[0]!.target).toMatchObject({ '--tx': '0.0vw' });
    expect(Number.parseFloat(String(phase!.cards[0]!.target['--ty' as never]))).toBeLessThan(0);
  });

  it('does not mistake the cards somebody took for cards they drew', () => {
    const before = base({ table: bout, taking: true, defender: 2 });
    const after = base({ hands: new Map(before.hands).set(2, 10) });
    // One phase, not two: a hand that grew by exactly what it picked up off the
    // table has drawn nothing, and dealing it four more would be a lie.
    expect(planFlights(before, after, chairs)).toHaveLength(1);
  });
});

describe('dealing from the deck', () => {
  it('sends one card per card needed, face down, in the engine’s order', () => {
    const before = base({ deckCount: 12, attacker: 2, defender: 3 });
    const after = base({
      deckCount: 9,
      attacker: 2,
      defender: 3,
      hands: new Map<Seat, number>([
        [0, 7],
        [1, 6],
        [2, 7],
        [3, 7],
      ]),
    });
    const [phase] = planFlights(before, after, chairs);

    expect(phase!.from).toBe('deck');
    expect(phase!.cards).toHaveLength(3);
    expect(phase!.cards.every((c) => c.faceDown && !c.flips)).toBe(true);
    // Attacker first, then clockwise, defender last.
    expect(phase!.cards.map((c) => c.key)).toEqual(['deal-2-0', 'deal-0-0', 'deal-3-0']);
    // They leave one after another rather than all at once.
    expect(phase!.cards.map((c) => c.delay)).toEqual([0, 90, 180]);
  });

  it('turns the trump card over as the very last card out of the deck', () => {
    const before = base({ deckCount: 2, trumpCard: card('6H') });
    const after = base({
      deckCount: 0,
      hands: new Map<Seat, number>([
        [0, 7],
        [1, 7],
        [2, 6],
        [3, 6],
      ]),
    });
    const [phase] = planFlights(before, after, chairs);

    expect(phase!.cards).toHaveLength(2);
    expect(phase!.cards[0]).toMatchObject({ faceDown: true, flips: false });
    // It has been lying face up under the pile all game; it turns over on its
    // way into the last hand.
    expect(phase!.cards[1]).toMatchObject({ faceDown: false, flips: true, card: card('6H') });
  });

  it('plays the pile out first and the deal after it', () => {
    const before = base({ table: [{ attack: card('7C'), defence: card('9C') }] });
    const after = base({
      deckCount: 10,
      hands: new Map<Seat, number>([
        [0, 7],
        [1, 7],
        [2, 6],
        [3, 6],
      ]),
    });
    const phases = planFlights(before, after, chairs);
    expect(phases.map((p) => p.from)).toEqual(['pile', 'deck']);
    // The deal waits for the pile to clear rather than crossing it.
    expect(phases[0]!.duration).toBeGreaterThan(0);
  });

  it('stays out of the way when nothing moved', () => {
    expect(planFlights(base(), base(), chairs)).toEqual([]);
  });
});
