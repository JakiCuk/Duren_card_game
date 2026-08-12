import { describe, expect, it } from 'vitest';
import type { CSSProperties } from 'react';
import { planFlights, readStep } from '../../src/client/game/Board.js';
import { parseCardCode, type GameEvent, type Seat } from '../../src/engine/index.js';

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
const pile = [{ attack: card('7C'), defence: card('9C') }];

const plan = (before: typeof pile, events: GameEvent[]) => planFlights(before, events, chairs);
const modes = (before: typeof pile, events: GameEvent[]): string[] =>
  plan(before, events).map((p) => p.mode);

describe('reading a move off its events', () => {
  it('rebuilds the pile as it stood when the bout ended', () => {
    // The last card played and the bout ending arrive together, so the table
    // the player is meant to look at exists only in the events.
    const step = readStep([], [
      { k: 'attack', seat: 0, card: card('7C'), throwIn: false },
      { k: 'defend', seat: 1, card: card('9C'), slot: 0 },
      { k: 'attack', seat: 2, card: card('7D'), throwIn: true },
      { k: 'bito', cards: [card('7C'), card('9C'), card('7D')] },
    ]);
    expect(step.pile).toEqual([
      { attack: card('7C'), defence: card('9C') },
      { attack: card('7D'), defence: null },
    ]);
    expect(step.plays.map((p) => p.seat)).toEqual([0, 1, 2]);
    expect(step.resolution).toEqual({ kind: 'bito' });
  });

  it('names the trump card without counting it twice', () => {
    // trumpTaken rides alongside the draw that contains it, not instead of it.
    const step = readStep([], [
      { k: 'draw', seat: 0, cards: [card('AS'), card('6H')] },
      { k: 'trumpTaken', seat: 0, card: card('6H') },
    ]);
    expect(step.deals).toEqual([
      { seat: 0, card: null },
      { seat: 0, card: card('6H') },
    ]);
  });
});

describe('what flies where when a bout ends', () => {
  it('scoops a taken bout up even when nobody could throw in', () => {
    // The regression this file exists for. With a throw-in available, "I take"
    // and the bout ending are two moves and the board sees the take flag. With
    // nothing to throw in the engine passes for everyone and resolves in the
    // same move, so the flag is never rendered — and every such bout used to
    // animate as if it had been beaten.
    const events: GameEvent[] = [
      { k: 'takeDeclared', seat: 2 },
      { k: 'pass', seat: 0, auto: true },
      { k: 'pass', seat: 3, auto: true },
      { k: 'take', seat: 2, cards: [card('7C'), card('9C')] },
    ];
    const [exit] = plan(pile, events);
    expect(exit!.mode).toBe('take');
    expect(exit!.cards.every((c) => c.flips)).toBe(true);
    // Towards seat 2, which sits at the top of the table.
    expect(Number.parseFloat(String(exit!.cards[0]!.place['--ty' as never]))).toBeLessThan(0);
  });

  it('sends a beaten bout face up towards the discard', () => {
    const [exit] = plan(pile, [{ k: 'bito', cards: [card('7C'), card('9C')] }]);
    expect(exit!.mode).toBe('bito');
    expect(exit!.cards.every((c) => !c.faceDown && !c.flips)).toBe(true);
    expect(exit!.cards[0]!.place).toMatchObject({ '--tx': '26vw', '--ty': '-19vh' });
  });

  it('holds the pile first when the last card landed in the same move', () => {
    const events: GameEvent[] = [
      { k: 'attack', seat: 3, card: card('7D'), throwIn: true },
      { k: 'bito', cards: [card('7C'), card('9C'), card('7D')] },
    ];
    const phases = plan(pile, events);
    expect(phases.map((p) => p.mode)).toEqual(['hold', 'bito']);

    const hold = phases[0]!;
    expect(hold.duration).toBeGreaterThanOrEqual(500);
    // Only the card that just arrived flies in; the rest are already lying there.
    expect(hold.cards.filter((c) => c.enters).map((c) => c.card)).toEqual([card('7D')]);
  });

  it('does not hold a pile the player has been looking at all along', () => {
    expect(modes(pile, [{ k: 'bito', cards: [card('7C'), card('9C')] }])).toEqual(['bito']);
  });

  it('stays out of the way until a bout actually ends', () => {
    expect(plan([], [{ k: 'attack', seat: 0, card: card('7C'), throwIn: false }])).toEqual([]);
    expect(plan([], [])).toEqual([]);
  });
});

describe('dealing from the deck', () => {
  const dealt: GameEvent[] = [
    { k: 'bito', cards: [card('7C'), card('9C')] },
    { k: 'draw', seat: 2, cards: [card('AS'), card('KS')] },
    { k: 'draw', seat: 0, cards: [card('QS')] },
  ];

  it('sends one card per card drawn, face down, in the engine’s own order', () => {
    const phases = plan(pile, dealt);
    expect(phases.map((p) => p.mode)).toEqual(['bito', 'deal']);

    const deal = phases[1]!;
    expect(deal.from).toBe('deck');
    expect(deal.cards).toHaveLength(3);
    expect(deal.cards.every((c) => c.faceDown && !c.flips)).toBe(true);
    // They leave one after another rather than all at once.
    const delays = deal.cards.map((c) => c.delay);
    expect(delays[0]).toBe(0);
    expect(delays[1]).toBeGreaterThan(0);
    expect(delays[2]).toBe(delays[1]! * 2);
  });

  it('turns the trump card over as the very last card out of the deck', () => {
    const phases = plan(pile, [
      { k: 'bito', cards: [card('7C'), card('9C')] },
      { k: 'draw', seat: 1, cards: [card('AS'), card('6H')] },
      { k: 'trumpTaken', seat: 1, card: card('6H') },
    ]);
    const deal = phases[1]!;
    expect(deal.cards[0]).toMatchObject({ faceDown: true, flips: false });
    // It has been lying face up under the pile all game; it turns over on its
    // way into the last hand.
    expect(deal.cards[1]).toMatchObject({ faceDown: false, flips: true, card: card('6H') });
  });

  it('deals nothing when the deck dealt nothing', () => {
    // Regression from a six-handed endgame: an exhausted deck kept dealing
    // phantom cards because a growing hand was read as proof of a draw.
    expect(modes(pile, [{ k: 'take', seat: 1, cards: [card('7C'), card('9C')] }])).toEqual(['take']);
  });
});
