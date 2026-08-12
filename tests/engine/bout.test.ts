import { describe, expect, it } from 'vitest';
import {
  applyMove,
  applyMoves,
  assertInvariants,
  parseCardCode,
  type GameEvent,
  type GameState,
  type Move,
} from '../../src/engine/index.js';
import { codes, handOf, makeState } from './helpers.js';

const attack = (seat: number, card: string): Move => ({ t: 'ATTACK', seat, card: parseCardCode(card) });
const defend = (seat: number, card: string, slot = 0): Move => ({
  t: 'DEFEND',
  seat,
  card: parseCardCode(card),
  slot,
});
const take = (seat: number): Move => ({ t: 'TAKE', seat });
const pass = (seat: number): Move => ({ t: 'PASS', seat });

const kinds = (events: GameEvent[]): string[] => events.map((e) => e.k);
const find = <K extends GameEvent['k']>(events: GameEvent[], k: K): Extract<GameEvent, { k: K }>[] =>
  events.filter((e): e is Extract<GameEvent, { k: K }> => e.k === k);

const run = (s: GameState, moves: Move[]) => {
  const result = applyMoves(s, moves);
  assertInvariants(result.state, 'after scripted moves');
  return result;
};

describe('a beaten bout', () => {
  it('sends the cards to the discard and hands the attack to the defender', () => {
    const s = makeState({
      hands: ['6C 8D', '7C 9D', 'TH KH'],
      deck: '6H 7H 8H 9H TS', // bottom card TS -> spades are trump
      attacker: 0,
      defender: 1,
      config: { handSize: 2 },
    });

    const { state, events } = run(s, [attack(0, '6C'), defend(1, '7C')]);

    expect(kinds(events)).toContain('bito');
    expect(find(events, 'bito')[0]!.cards.map((c) => c)).toHaveLength(2);
    expect(codes(state.discard.slice(-2))).toBe('6C 7C');
    expect(state.table).toEqual([]);
    // The successful defender earns the attack.
    expect(state.attacker).toBe(1);
    expect(state.defender).toBe(2);
    expect(state.boutIndex).toBe(2);
  });
});

describe('a taken bout', () => {
  it('moves the table into the defender hand and skips them exactly once', () => {
    const s = makeState({
      hands: ['6C', '7D', '8H', '9S'],
      trump: 'S',
      attacker: 0,
      defender: 1,
      config: { handSize: 1 },
    });

    const { state, events } = run(s, [attack(0, '6C'), take(1)]);

    expect(kinds(events)).toContain('takeDeclared');
    expect(codes(find(events, 'take')[0]!.cards)).toBe('6C');
    expect(handOf(state, 1)).toBe('6C 7D');
    // Seat 0 emptied its hand and the deck is dry, so it is out; the attack
    // passes over the defender to seat 2.
    expect(state.players[0]!.outAtStep).not.toBeNull();
    expect(state.attacker).toBe(2);
    expect(state.defender).toBe(3);
  });

  it('lets the other attackers pile on before the cards are collected', () => {
    const s = makeState({
      hands: ['6C 9D', '7D KH', '6H TS'],
      trump: 'S',
      attacker: 0,
      defender: 1,
      config: { handSize: 2 },
    });

    const mid = applyMove(s, attack(0, '6C')).state;
    expect(mid.table).toHaveLength(1);

    const declared = applyMove(mid, take(1)).state;
    expect(declared.defenderTaking).toBe(true);

    // Seat 2 holds a six and may still throw it in.
    const { state, events } = run(declared, [attack(2, '6H')]);
    expect(codes(find(events, 'take')[0]!.cards)).toBe('6C 6H');
    expect(handOf(state, 1)).toBe('6C 6H 7D KH');
  });
});

describe('refilling', () => {
  it('draws attacker first, then clockwise, and the defender last', () => {
    const s = makeState({
      hands: ['6C', '7D', '8H'],
      deck: '9C TD JH', // JH at the bottom -> hearts are trump
      attacker: 0,
      defender: 1,
      config: { handSize: 2 },
    });

    const { state, events } = run(s, [attack(0, '6C'), take(1)]);

    const draws = find(events, 'draw');
    expect(draws.map((d) => d.seat)).toEqual([0, 2]); // seat 1 already holds two cards
    expect(handOf(state, 0)).toBe('9C TD');
    expect(handOf(state, 2)).toBe('8H JH');
    expect(state.deck).toEqual([]);
  });

  it('gives the face-up trump card to whoever draws last', () => {
    const s = makeState({
      hands: ['6C 7H', '7D', '8C'],
      deck: '9C TS',
      attacker: 0,
      defender: 1,
      config: { handSize: 2 },
    });

    const { state, events } = run(s, [attack(0, '6C'), take(1)]);

    // Seat 0 needs one card and draws the 9C; seat 2 needs one and gets the
    // face-up TS along with it.
    const trumpTaken = find(events, 'trumpTaken');
    expect(trumpTaken).toHaveLength(1);
    expect(codes([trumpTaken[0]!.card])).toBe('TS');
    expect(trumpTaken[0]!.seat).toBe(2);
    expect(handOf(state, 2)).toBe('8C TS');
    expect(state.trumpCard).toBeNull();
    expect(state.trump).toBe(3); // spades
  });

  it('stops mid-refill when the deck runs dry', () => {
    const s = makeState({
      hands: ['6C', '7D', '8H'],
      deck: '9S', // a single card for three needy players
      attacker: 0,
      defender: 1,
      config: { handSize: 2 },
    });

    const { state } = run(s, [attack(0, '6C'), take(1)]);
    expect(handOf(state, 0)).toBe('9S');
    expect(state.deck).toEqual([]);
    expect(state.players[2]!.hand).toHaveLength(1);
  });
});

describe('auto-pass', () => {
  it('passes for an attacker who holds no matching rank', () => {
    const s = makeState({
      hands: ['6C 9D', '7C KH'],
      trump: 'S',
      attacker: 0,
      defender: 1,
      config: { handSize: 2 },
    });

    const { events } = applyMove(s, attack(0, '6C'));
    const passes = find(events, 'pass');
    expect(passes).toHaveLength(1);
    expect(passes[0]).toMatchObject({ seat: 0, auto: true });
  });

  it('leaves a real choice alone', () => {
    const s = makeState({
      hands: ['6C 6D', '7C KH'],
      trump: 'S',
      attacker: 0,
      defender: 1,
      config: { handSize: 2 },
    });

    const { state, events } = applyMove(s, attack(0, '6C'));
    expect(find(events, 'pass')).toHaveLength(0);
    expect(state.passed[0]).toBe(false);
  });

  it('reopens the choice when a new rank lands on the table', () => {
    const s = makeState({
      hands: ['6C 7D', '7C KH'],
      trump: 'S',
      attacker: 0,
      defender: 1,
      config: { handSize: 2 },
    });

    // 6C alone gives seat 0 nothing to add, so the engine passes for it...
    const afterAttack = applyMove(s, attack(0, '6C')).state;
    expect(afterAttack.passed[0]).toBe(true);

    // ...but the 7 used to beat it puts seat 0 back in the game.
    const afterDefence = applyMove(afterAttack, defend(1, '7C')).state;
    expect(afterDefence.passed[0]).toBe(false);
    expect(afterDefence.table).toHaveLength(1);
  });
});

describe('ending the game', () => {
  it('names the last player holding cards as the durak', () => {
    const s = makeState({
      hands: ['6C', '7C', '8H'],
      trump: 'S',
      attacker: 0,
      defender: 1,
      config: { handSize: 1 },
    });

    const { state, events } = run(s, [attack(0, '6C'), defend(1, '7C')]);

    expect(state.phase).toBe('finished');
    expect(state.result).toEqual({
      durak: 'p2',
      order: ['p0', 'p1'],
      reason: 'played_out',
      loserTeam: null,
    });
    expect(kinds(events)).toContain('gameOver');
    expect(find(events, 'out').map((e) => e.seat).sort()).toEqual([0, 1]);
  });

  it('calls it a draw when the last players go out together', () => {
    const s = makeState({
      hands: ['6C', '7C'],
      trump: 'S',
      attacker: 0,
      defender: 1,
      config: { handSize: 1 },
    });

    const { state } = run(s, [attack(0, '6C'), defend(1, '7C')]);
    expect(state.result).toEqual({
      durak: null,
      order: ['p0', 'p1'],
      reason: 'played_out',
      loserTeam: null,
    });
  });

  it('refuses further moves once finished', () => {
    const s = makeState({
      hands: ['6C', '7C'],
      trump: 'S',
      attacker: 0,
      defender: 1,
      config: { handSize: 1 },
    });
    const { state } = run(s, [attack(0, '6C'), defend(1, '7C')]);
    expect(() => applyMove(state, pass(0))).toThrow(/game_finished/);
  });
});

describe('role rotation with more than two players', () => {
  it('moves the attack past a beaten defender who has gone out', () => {
    const s = makeState({
      hands: ['6C', '7C', '8C', '9C'],
      trump: 'S',
      attacker: 0,
      defender: 1,
      config: { handSize: 1 },
    });

    const { state } = run(s, [attack(0, '6C'), defend(1, '7C')]);
    expect(state.players.filter((p) => p.outAtStep !== null).map((p) => p.seat)).toEqual([0, 1]);
    expect(state.attacker).toBe(2);
    expect(state.defender).toBe(3);
  });
});
