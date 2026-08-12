import { describe, expect, it } from 'vitest';
import { playedBy } from '../../src/client/game/model.js';
import { applyMove, createGame, legalMoves, ctxOf, parseCardCode } from '../../src/engine/index.js';
import type { GameEvent } from '../../src/engine/index.js';
import { DEFAULT_RULES } from '../../src/shared/rules.js';

const card = parseCardCode;

describe('who played which card', () => {
  it('credits a throw-in to the player who threw it, not to the attacker', () => {
    const events: GameEvent[] = [
      { k: 'attack', seat: 0, card: card('7C'), throwIn: false },
      { k: 'defend', seat: 1, card: card('9C'), slot: 0 },
      { k: 'attack', seat: 2, card: card('7D'), throwIn: true },
    ];
    const map = playedBy(events);
    expect(map.get(card('7C'))).toBe(0);
    expect(map.get(card('9C'))).toBe(1);
    // The board cannot tell this from the pile: both sevens are just lying
    // there, and animating the second from seat 0 would point at the wrong
    // player at exactly the moment somebody else piled on.
    expect(map.get(card('7D'))).toBe(2);
  });

  it('follows a transferred card to the player who transferred it', () => {
    const map = playedBy([{ k: 'transfer', seat: 1, to: 2, card: card('7H'), revealed: false }]);
    expect(map.get(card('7H'))).toBe(1);
  });

  it('ignores everything that is not a card reaching the table', () => {
    const map = playedBy([
      { k: 'pass', seat: 0, auto: false },
      { k: 'takeDeclared', seat: 1 },
      { k: 'bito', cards: [card('7C')] },
      { k: 'draw', seat: 0, cards: [card('AS')] },
    ]);
    expect(map.size).toBe(0);
  });

  it('knows the origin of every card on the table in a real game', () => {
    // The point of the map is that it never runs dry: whatever ends up on the
    // table came from somewhere, and the board must be able to say where.
    const dealt = createGame({ players: ['p0', 'p1', 'p2'], config: DEFAULT_RULES, seed: 'origins' });
    let state = dealt.state;
    const all: GameEvent[] = [...dealt.events];

    for (let step = 0; step < 120 && state.phase === 'bout'; step++) {
      const seat = [0, 1, 2].find((s) => legalMoves(ctxOf(state), s).length > 0);
      if (seat === undefined) break;
      const move = legalMoves(ctxOf(state), seat)[0]!;
      const applied = applyMove(state, move);
      state = applied.state;
      all.push(...applied.events);

      const map = playedBy(all);
      for (const slot of state.table) {
        expect(map.has(slot.attack), 'unknown attacker for a card on the table').toBe(true);
        if (slot.defence !== null) expect(map.has(slot.defence)).toBe(true);
      }
    }
  });
});
