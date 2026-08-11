import { describe, expect, it } from 'vitest';
import {
  applyMove,
  attackCap,
  cardCode,
  ctxOf,
  eligibleAttackers,
  isLegal,
  legalMoves,
  parseCardCode,
  transferTarget,
  type Move,
} from '../../src/engine/index.js';
import { MAX_BOUTS_WITHOUT_PROGRESS } from '../../src/engine/state.js';
import { seedRng } from '../../src/engine/rng.js';
import { playBotGame, randomSetup } from '../../tools/sim.js';
import { handOf, makeState } from './helpers.js';

const summary = (moves: Move[]): string[] =>
  moves
    .map((m) => {
      switch (m.t) {
        case 'ATTACK':
          return `ATTACK ${cardCode(m.card)}`;
        case 'DEFEND':
          return `DEFEND ${cardCode(m.card)}@${m.slot}`;
        case 'TRANSFER':
          return `TRANSFER ${cardCode(m.card)}${m.reveal ? ' (reveal)' : ''}`;
        default:
          return m.t;
      }
    })
    .sort();

const transfer = (enabled = true, over: Partial<{ withTrumpReveal: boolean; allowChains: boolean }> = {}) => ({
  transfer: { enabled, withTrumpReveal: false, allowChains: false, ...over },
});

describe('perevodnoy (transfer)', () => {
  it('is not offered at all when the house rule is off', () => {
    const s = makeState({ hands: ['KH', '7D 8C'], trump: 'S', table: [['7C', null]] });
    expect(summary(legalMoves(ctxOf(s), 1))).toEqual(['DEFEND 8C@0', 'TAKE']);
  });

  it('offers a matching rank, and hands the defence to the next player', () => {
    const s = makeState({
      hands: ['KH', '7D 8C', 'AC AD'],
      trump: 'S',
      table: [['7C', null]],
      attacker: 0,
      defender: 1,
      config: transfer(),
    });
    expect(summary(legalMoves(ctxOf(s), 1))).toContain('TRANSFER 7D');
    expect(transferTarget(ctxOf(s))).toBe(2);

    const after = applyMove(s, { t: 'TRANSFER', seat: 1, card: parseCardCode('7D'), reveal: false }).state;
    expect(after.defender).toBe(2);
    expect(after.attacker).toBe(0);
    expect(after.table).toHaveLength(2);
    expect(handOf(after, 1)).toBe('8C');
    expect(after.transfersThisBout).toBe(1);
  });

  it('is impossible once anything on the table has been beaten', () => {
    const s = makeState({
      hands: ['KH', '7D 8C', 'AC'],
      trump: 'S',
      table: [['7C', '9C'], ['7H', null]],
      defenderHandAtBoutStart: 3,
      config: transfer(),
    });
    expect(summary(legalMoves(ctxOf(s), 1))).not.toContain('TRANSFER 7D');
  });

  it('is impossible when the attacks are of mixed ranks', () => {
    const s = makeState({
      hands: ['KH', '7D 8C', 'AC'],
      trump: 'S',
      table: [['7C', null], ['9H', null]],
      defenderHandAtBoutStart: 3,
      config: transfer(),
    });
    expect(summary(legalMoves(ctxOf(s), 1))).not.toContain('TRANSFER 7D');
  });

  it('refuses to hand a big attack to somebody who cannot answer it', () => {
    // Seat 2 holds a single card and would face three. This is a real rule, not
    // an implementation detail: without it a one-card player gets buried.
    const s = makeState({
      hands: ['KH KD', '7D 8C', 'AC'],
      trump: 'S',
      table: [['7C', null], ['7H', null]],
      attacker: 0,
      defender: 1,
      defenderHandAtBoutStart: 3,
      config: transfer(),
    });
    expect(summary(legalMoves(ctxOf(s), 1))).not.toContain('TRANSFER 7D');

    const roomier = makeState({
      hands: ['KH KD', '7D 8C', 'AC AD AH'],
      trump: 'S',
      table: [['7C', null], ['7H', null]],
      attacker: 0,
      defender: 1,
      defenderHandAtBoutStart: 3,
      config: transfer(),
    });
    expect(summary(legalMoves(ctxOf(roomier), 1))).toContain('TRANSFER 7D');
  });

  it('respects a fixed attack cap — a transfer must not smuggle a card past it', () => {
    const s = makeState({
      hands: ['KH KD', '7D 8C', 'AC AD AH AS'],
      trump: 'S',
      table: [['7C', null], ['7H', null]],
      attacker: 0,
      defender: 1,
      defenderHandAtBoutStart: 3,
      config: { ...transfer(), attackCap: { kind: 'fixed', n: 2 } },
    });
    expect(attackCap(ctxOf(s))).toBe(2);
    expect(summary(legalMoves(ctxOf(s), 1))).not.toContain('TRANSFER 7D');
  });

  it('allows a chain only when the house rule permits it', () => {
    const spec = {
      hands: ['KH', '7D 8C', '7S AC'],
      trump: 'S',
      table: [['7C', null]] as [string, string | null][],
      attacker: 0,
      defender: 1,
      transfersThisBout: 1,
    };
    const noChains = makeState({ ...spec, config: transfer(true) });
    const chains = makeState({ ...spec, config: transfer(true, { allowChains: true }) });
    expect(summary(legalMoves(ctxOf(noChains), 1))).not.toContain('TRANSFER 7D');
    expect(summary(legalMoves(ctxOf(chains), 1))).toContain('TRANSFER 7D');
  });

  it('keeps a revealed trump in hand and leaves the table alone', () => {
    const s = makeState({
      hands: ['KH', '7S 8C', 'AC AD'],
      trump: 'S',
      table: [['7C', null]],
      attacker: 0,
      defender: 1,
      config: transfer(true, { withTrumpReveal: true }),
    });
    expect(summary(legalMoves(ctxOf(s), 1))).toContain('TRANSFER 7S (reveal)');

    const after = applyMove(s, { t: 'TRANSFER', seat: 1, card: parseCardCode('7S'), reveal: true }).state;
    expect(after.defender).toBe(2);
    expect(after.table).toHaveLength(1);
    // The revealed trump is still ours; only the duty to defend moved.
    expect(handOf(after, 1)).toBe('7S 8C');
    expect(after.players[1]!.hand).toContain(parseCardCode('7S'));
  });

  it('offers a reveal only for a trump, never for a plain card', () => {
    const s = makeState({
      hands: ['KH', '7D 8C', 'AC AD'],
      trump: 'S',
      table: [['7C', null]],
      config: transfer(true, { withTrumpReveal: true }),
    });
    expect(summary(legalMoves(ctxOf(s), 1))).toContain('TRANSFER 7D');
    expect(summary(legalMoves(ctxOf(s), 1))).not.toContain('TRANSFER 7D (reveal)');
  });

  it('bounces the attack back at the attacker in a two-handed game', () => {
    const s = makeState({
      hands: ['KH KD', '7D 8C'],
      trump: 'S',
      table: [['7C', null]],
      attacker: 0,
      defender: 1,
      config: transfer(),
    });
    const after = applyMove(s, { t: 'TRANSFER', seat: 1, card: parseCardCode('7D'), reveal: false }).state;
    // Seat 0 now defends, so the player who passed it on becomes the attacker —
    // otherwise the two roles would collide on one seat.
    expect(after.defender).toBe(0);
    expect(after.attacker).toBe(1);
    expect(eligibleAttackers(ctxOf(after))).toEqual([1]);
  });
});

describe('attacker scope', () => {
  it('limits the attack to the defender’s neighbours', () => {
    const s = makeState({
      hands: ['6C', '7C', '8C', '9C', 'TC'],
      trump: 'S',
      attacker: 0,
      defender: 1,
      config: { attackerScope: 'neighbours' },
    });
    // Neighbours of seat 1 are seats 0 and 2; seats 3 and 4 sit this one out.
    expect(eligibleAttackers(ctxOf(s))).toEqual([0, 2]);

    const everyone = makeState({
      hands: ['6C', '7C', '8C', '9C', 'TC'],
      trump: 'S',
      attacker: 0,
      defender: 1,
      config: { attackerScope: 'all' },
    });
    expect(eligibleAttackers(ctxOf(everyone))).toEqual([0, 2, 3, 4]);
  });

  it('recomputes the neighbours after a transfer moves the defence', () => {
    const s = makeState({
      hands: ['6C', '7D 8C', '9C 9D', 'TC', 'JC'],
      trump: 'S',
      table: [['7C', null]],
      attacker: 0,
      defender: 1,
      defenderHandAtBoutStart: 2,
      config: { ...transfer(), attackerScope: 'neighbours' },
    });
    expect(eligibleAttackers(ctxOf(s))).toEqual([0, 2]);

    const after = applyMove(s, { t: 'TRANSFER', seat: 1, card: parseCardCode('7D'), reveal: false }).state;
    // Seat 2 now defends, so the neighbours become seats 1 and 3 — and the
    // player who just transferred is one of them.
    expect(after.defender).toBe(2);
    expect(eligibleAttackers(ctxOf(after)).sort()).toEqual([1, 3]);
  });
});

describe('attack caps', () => {
  const spec = {
    hands: ['6C 6D 6H 6S 7C', 'KC KD KH KS QC QD'],
    trump: 'S',
    table: [['8C', null]] as [string, string | null][],
    defenderHandAtBoutStart: 6,
  };

  it('follows a fixed limit', () => {
    expect(attackCap(ctxOf(makeState({ ...spec, config: { attackCap: { kind: 'fixed', n: 3 } } })))).toBe(3);
  });

  it('treats "unlimited" as the defender’s hand, because nothing else is possible', () => {
    const unlimited = makeState({ ...spec, config: { attackCap: { kind: 'unlimited' } } });
    const byHand = makeState({ ...spec, config: { attackCap: { kind: 'defenderHand' } } });
    expect(attackCap(ctxOf(unlimited))).toBe(attackCap(ctxOf(byHand)));
    expect(attackCap(ctxOf(unlimited))).toBe(6);
  });

  it('only differs after a take, which is what the separate setting is for', () => {
    const taking = { ...spec, defenderTaking: true, defenderHandAtBoutStart: 2 };
    const unlimited = makeState({
      ...taking,
      config: { attackCap: { kind: 'unlimited' }, throwInAfterTakeCap: 'unlimited', maxTableSlots: 6 },
    });
    const bounded = makeState({
      ...taking,
      config: { attackCap: { kind: 'unlimited' }, throwInAfterTakeCap: 'defenderHandAtBoutStart' },
    });
    expect(attackCap(ctxOf(unlimited))).toBe(6);
    expect(attackCap(ctxOf(bounded))).toBe(2);
  });

  it('never exceeds the hard table ceiling under any setting', () => {
    const s = makeState({
      ...spec,
      defenderTaking: true,
      config: { attackCap: { kind: 'unlimited' }, throwInAfterTakeCap: 'unlimited', maxTableSlots: 2 },
    });
    expect(attackCap(ctxOf(s))).toBe(2);
  });
});

describe('defenderMustBeatAll', () => {
  it('removes taking while any defence is possible', () => {
    const s = makeState({
      hands: ['KH', '8C 6D'],
      trump: 'S',
      table: [['7C', null]],
      config: { defenderMustBeatAll: true },
    });
    expect(summary(legalMoves(ctxOf(s), 1))).toEqual(['DEFEND 8C@0']);
    expect(isLegal(ctxOf(s), { t: 'TAKE', seat: 1 })).toBe(false);
  });

  it('restores taking when nothing beats the attack', () => {
    const s = makeState({
      hands: ['KH', '6D 7H'],
      trump: 'S',
      table: [['AC', null]],
      config: { defenderMustBeatAll: true },
    });
    expect(summary(legalMoves(ctxOf(s), 1))).toEqual(['TAKE']);
  });

  it('counts a possible transfer as a way of not taking', () => {
    const s = makeState({
      hands: ['KH', '7D 6H', 'AC AD'],
      trump: 'S',
      table: [['7C', null]],
      attacker: 0,
      defender: 1,
      config: { ...transfer(), defenderMustBeatAll: true },
    });
    expect(summary(legalMoves(ctxOf(s), 1))).toEqual(['TRANSFER 7D']);
  });
});

describe('termination', () => {
  it('ends a position that is only circulating cards', () => {
    // Regression: these exact rules and bots produced a three-bout cycle that
    // repeated forever — one player handing a card on to the next, round and
    // round, with nothing ever reaching the discard.
    const { config } = randomSetup(seedRng('matrix:900980'), 4);
    const out = playBotGame({ seed: 900980, levels: [2, 1, 2, 1], config, check: false });

    expect(out.state.phase).toBe('finished');
    expect(out.state.result?.reason).toBe('stalemate');
    expect(out.state.result?.durak).toBeNull();
    expect(out.steps).toBeLessThan(1000);
  });

  it('does not mistake ordinary play for a stalemate', () => {
    for (let seed = 0; seed < 200; seed++) {
      const out = playBotGame({ seed, levels: [2, 1], check: false });
      expect(out.state.result?.reason, `seed ${seed}`).toBe('played_out');
    }
  });

  it('keeps the stalemate threshold well clear of normal play', () => {
    expect(MAX_BOUTS_WITHOUT_PROGRESS).toBeGreaterThan(16);
  });
});
