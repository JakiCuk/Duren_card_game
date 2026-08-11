import { describe, expect, it } from 'vitest';
import {
  applyMove,
  attackCap,
  boutIsResolvable,
  cardCode,
  ctxOf,
  eligibleAttackers,
  IllegalMoveError,
  isLegal,
  legalMoves,
  parseCardCode,
  type Move,
} from '../../src/engine/index.js';
import { makeState } from './helpers.js';

/** Readable summary of what a seat may do, e.g. `['ATTACK 6C', 'PASS']`. */
const describeMoves = (moves: Move[]): string[] =>
  moves
    .map((m) => {
      switch (m.t) {
        case 'ATTACK':
          return `ATTACK ${cardCode(m.card)}`;
        case 'DEFEND':
          return `DEFEND ${cardCode(m.card)}@${m.slot}`;
        default:
          return m.t;
      }
    })
    .sort();

describe('attacking', () => {
  it('lets only the primary attacker open a bout, with any card', () => {
    const s = makeState({ hands: ['6C 7D AS', 'KH'], trump: 'S' });
    expect(describeMoves(legalMoves(ctxOf(s), 0))).toEqual(['ATTACK 6C', 'ATTACK 7D', 'ATTACK AS']);
    expect(legalMoves(ctxOf(s), 1)).toEqual([]);
    expect(isLegal(ctxOf(s), { t: 'PASS', seat: 0 })).toBe(false);
  });

  it('restricts throw-ins to ranks already on the table', () => {
    const s = makeState({
      hands: ['7H 8C 9D', 'KH QD'],
      table: [['7C', null]],
      trump: 'S',
      passed: [false, false],
    });
    expect(describeMoves(legalMoves(ctxOf(s), 0))).toEqual(['ATTACK 7H', 'PASS']);
  });

  it('counts the defence card rank as throwable too', () => {
    // The 9 that beat the 7 opens the door for another 9. Forgetting this is
    // the classic Durak implementation bug.
    const s = makeState({
      hands: ['9D 8C', 'KH'],
      table: [['7C', '9C']],
      trump: 'S',
      defenderHandAtBoutStart: 2, // held KH and 9C when the bout opened
    });
    expect(describeMoves(legalMoves(ctxOf(s), 0))).toEqual(['ATTACK 9D', 'PASS']);
  });

  it('caps the table at the defender hand size when the bout opened', () => {
    const s = makeState({
      hands: ['6C 6D 6H', '6S KH'],
      table: [['7C', null], ['7D', null]],
      trump: 'S',
      defenderHandAtBoutStart: 2,
    });
    expect(attackCap(ctxOf(s))).toBe(2);
    expect(describeMoves(legalMoves(ctxOf(s), 0))).toEqual(['PASS']);
  });

  it('applies the hard table ceiling even when hands are large', () => {
    const s = makeState({
      hands: ['6C 6D 6H 6S 7C 7D 7H', '8C 8D 8H 8S 9C 9D 9H'],
      table: [['TC', null]],
      trump: 'S',
      config: { maxTableSlots: 2 },
      defenderHandAtBoutStart: 7,
    });
    expect(attackCap(ctxOf(s))).toBe(2);
  });

  it('applies the first-bout cap only to the first bout', () => {
    const spec = {
      hands: ['6C 6D 6H 6S 7C', 'KC KD KH KS QC QD'],
      table: [['8C', null], ['8D', null], ['8H', null], ['8S', null]] as [string, string | null][],
      trump: 'S',
      config: { firstBoutCapFive: true },
      defenderHandAtBoutStart: 6,
    };
    expect(attackCap(ctxOf(makeState({ ...spec, boutIndex: 0 })))).toBe(5);
    expect(attackCap(ctxOf(makeState({ ...spec, boutIndex: 1 })))).toBe(6);
  });
});

describe('defending', () => {
  it('offers every card that beats an unbeaten slot, plus taking', () => {
    const s = makeState({
      hands: ['KH', '8C 9C 6S 5H'],
      table: [['7C', null]],
      trump: 'S',
    });
    expect(describeMoves(legalMoves(ctxOf(s), 1))).toEqual([
      'DEFEND 6S@0',
      'DEFEND 8C@0',
      'DEFEND 9C@0',
      'TAKE',
    ]);
  });

  it('names the slot so that identical ranks stay unambiguous', () => {
    const s = makeState({
      hands: ['KH', '8C 8D'],
      table: [['7C', null], ['7D', null]],
      trump: 'S',
    });
    expect(describeMoves(legalMoves(ctxOf(s), 1))).toEqual(['DEFEND 8C@0', 'DEFEND 8D@1', 'TAKE']);
  });

  it('always leaves taking available, even with a beater in hand', () => {
    // AC beats 7C outright, yet taking stays a legal strategic choice — that is
    // what makes "take when you could defend" a possible bluff later on.
    const s = makeState({ hands: ['KH', 'AC'], trump: 'S', table: [['7C', null]] });
    expect(isLegal(ctxOf(s), { t: 'TAKE', seat: 1 })).toBe(true);
    expect(describeMoves(legalMoves(ctxOf(s), 1))).toEqual(['DEFEND AC@0', 'TAKE']);
  });

  it('gives the defender nothing to do once every slot is covered', () => {
    const s = makeState({ hands: ['KH', 'AC'], trump: 'S', table: [['7C', '8C']] });
    expect(legalMoves(ctxOf(s), 1)).toEqual([]);
  });

  it('silences the defender after they declare a take', () => {
    const s = makeState({
      hands: ['KH', 'AC'],
      trump: 'S',
      table: [['7C', null]],
      defenderTaking: true,
    });
    expect(legalMoves(ctxOf(s), 1)).toEqual([]);
  });
});

describe('piling on after a take', () => {
  const base = {
    hands: ['7H 8C', 'AC KD'],
    table: [['7C', null]] as [string, string | null][],
    trump: 'S',
    defenderTaking: true,
    defenderHandAtBoutStart: 2,
  };

  it('allows matching throw-ins when the house rule is on', () => {
    expect(describeMoves(legalMoves(ctxOf(makeState(base)), 0))).toEqual(['ATTACK 7H', 'PASS']);
  });

  it('forbids them when it is off', () => {
    const s = makeState({ ...base, config: { throwInAfterTake: false } });
    expect(describeMoves(legalMoves(ctxOf(s), 0))).toEqual(['PASS']);
  });
});

describe('eligibility', () => {
  it('excludes the defender and anyone with an empty hand', () => {
    const s = makeState({ hands: ['6C', '7C', ''], trump: 'S', attacker: 0, defender: 1 });
    expect(eligibleAttackers(ctxOf(s))).toEqual([0]);
  });

  it('rejects a second pass from the same seat', () => {
    const s = makeState({
      hands: ['6C 7H', 'AC'],
      table: [['7C', null]],
      trump: 'S',
      passed: [true, false],
    });
    expect(isLegal(ctxOf(s), { t: 'PASS', seat: 0 })).toBe(false);
    expect(isLegal(ctxOf(s), { t: 'ATTACK', seat: 0, card: parseCardCode('7H') })).toBe(false);
  });
});

describe('applyMove rejects what legalMoves excludes', () => {
  it('throws IllegalMoveError rather than corrupting the state', () => {
    const s = makeState({ hands: ['6C', 'AC'], trump: 'S' });
    expect(() => applyMove(s, { t: 'ATTACK', seat: 1, card: parseCardCode('AC') })).toThrow(IllegalMoveError);
    expect(() => applyMove(s, { t: 'ATTACK', seat: 0, card: parseCardCode('KH') })).toThrow(IllegalMoveError);
    expect(() => applyMove(s, { t: 'PASS', seat: 0 })).toThrow(IllegalMoveError);
  });

  it('does not mutate the state it was given', () => {
    const s = makeState({ hands: ['6C 7C', 'AC'], trump: 'S' });
    const before = JSON.stringify(s);
    applyMove(s, { t: 'ATTACK', seat: 0, card: parseCardCode('6C') });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('bout resolution predicate', () => {
  it('is false while an attacker may still act', () => {
    const s = makeState({
      hands: ['7H', 'AC'],
      table: [['7C', '8C']],
      trump: 'S',
      passed: [false, false],
    });
    expect(boutIsResolvable(ctxOf(s))).toBe(false);
  });

  it('is false while an unbeaten card sits on the table', () => {
    const s = makeState({
      hands: ['KD', 'AC'],
      table: [['7C', null]],
      trump: 'S',
      passed: [true, false],
    });
    expect(boutIsResolvable(ctxOf(s))).toBe(false);
  });
});
