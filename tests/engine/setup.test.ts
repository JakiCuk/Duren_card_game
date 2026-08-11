import { describe, expect, it } from 'vitest';
import {
  assertInvariants,
  cardCode,
  createGame,
  rankOf,
  suitOf,
  type GameState,
} from '../../src/engine/index.js';
import { DEFAULT_RULES, type RuleConfig } from '../../src/shared/rules.js';

const deal = (players: number, seed: number | string, config: Partial<RuleConfig> = {}): GameState =>
  createGame({
    players: Array.from({ length: players }, (_, i) => `p${i}`),
    config: { ...DEFAULT_RULES, ...config },
    seed,
  }).state;

describe('createGame', () => {
  it('deals a full hand to everyone and leaves the trump card at the bottom', () => {
    for (let seed = 0; seed < 50; seed++) {
      const s = deal(4, seed);
      expect(s.players.map((p) => p.hand.length)).toEqual([6, 6, 6, 6]);
      expect(s.deck).toHaveLength(36 - 24);
      expect(s.trumpCard).toBe(s.deck[s.deck.length - 1]);
      expect(suitOf(s.trumpCard!)).toBe(s.trump);
      assertInvariants(s, `seed ${seed}`);
    }
  });

  it('reports the dealt hands and the trump card as an event', () => {
    const { state, events } = createGame({ players: ['a', 'b'], config: DEFAULT_RULES, seed: 3 });
    expect(events).toHaveLength(1);
    const dealt = events[0]!;
    expect(dealt.k).toBe('dealt');
    if (dealt.k !== 'dealt') throw new Error('unreachable');
    expect(dealt.hands).toEqual(state.players.map((p) => p.hand));
    expect(dealt.trumpCard).toBe(state.trumpCard);
  });

  it('opens with the holder of the lowest trump', () => {
    for (let seed = 0; seed < 200; seed++) {
      const s = deal(3, seed);
      const trumpsInHands = s.players.flatMap((p) =>
        p.hand.filter((c) => suitOf(c) === s.trump).map((c) => ({ seat: p.seat, card: c })),
      );
      if (trumpsInHands.length === 0) continue;
      const lowest = trumpsInHands.reduce((a, b) => (a.card <= b.card ? a : b));
      expect(s.attacker, `seed ${seed}: lowest trump ${cardCode(lowest.card)}`).toBe(lowest.seat);
      expect(s.defender).toBe((s.attacker + 1) % 3);
    }
  });

  it('falls back to the lowest card overall when no player holds a trump', () => {
    // With a 52-card deck and two players only 12 cards are dealt, so hands
    // without a single trump do occur — the fallback is not dead code.
    let covered = 0;
    for (let seed = 0; seed < 4000 && covered < 5; seed++) {
      const s = deal(2, seed, { deckSize: 52 });
      const hasTrump = s.players.some((p) => p.hand.some((c) => suitOf(c) === s.trump));
      if (hasTrump) continue;
      covered++;
      const lowest = s.players.flatMap((p) => p.hand.map((c) => ({ seat: p.seat, card: c })));
      const best = lowest.reduce((a, b) => (a.card <= b.card ? a : b));
      expect(s.attacker).toBe(best.seat);
      // Ascending card id means rank first, then suit order C < D < H < S.
      expect(rankOf(best.card)).toBe(Math.min(...lowest.map((x) => rankOf(x.card))));
    }
    expect(covered, 'no trumpless deal found — the fallback went untested').toBeGreaterThan(0);
  });

  it('honours the random first attacker without touching the deal', () => {
    const seats = new Set<number>();
    for (let seed = 0; seed < 100; seed++) seats.add(deal(4, seed, { firstAttacker: 'random' }).attacker);
    expect(seats.size).toBeGreaterThan(1);
  });

  it('refuses unplayable tables instead of dealing a broken game', () => {
    // 6 x 6 = 36: no card would be left to turn up as the trump.
    expect(() => deal(6, 1, { deckSize: 36 })).toThrow(/deck_too_small/);
    expect(() => deal(1, 1)).toThrow(/players_out_of_range/);
    expect(() =>
      createGame({ players: ['a', 'a'], config: DEFAULT_RULES, seed: 1 }),
    ).toThrow(/Duplicate/);
  });

  it('is fully determined by its seed', () => {
    const a = deal(4, 'same-seed');
    const b = deal(4, 'same-seed');
    expect(a.players.map((p) => p.hand)).toEqual(b.players.map((p) => p.hand));
    expect(a.deck).toEqual(b.deck);
    expect(a.attacker).toBe(b.attacker);
  });
});
