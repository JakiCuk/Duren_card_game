import { describe, expect, it } from 'vitest';
import {
  applyMove,
  applyMoves,
  ctxOf,
  eligibleAttackers,
  legalMoves,
  parseCardCode,
  sameTeam,
  teamAt,
  teamOf,
  type GameState,
} from '../../src/engine/index.js';
import { DEFAULT_RULES, validateConfig, type RuleConfig } from '../../src/shared/rules.js';
import { playGame, randomSetup } from '../../tools/sim.js';
import { seedRng } from '../../src/engine/rng.js';
import { makeState } from './helpers.js';

const TEAMS: Partial<RuleConfig> = { teams: { size: 2, seating: 'alternating' } };

describe('2v2 seating', () => {
  it('puts partners opposite each other, never adjacent', () => {
    const s = makeState({ hands: ['6C', '7C', '8C', '9C'], trump: 'S', config: TEAMS });
    expect([0, 1, 2, 3].map((seat) => teamAt(s, seat))).toEqual([0, 1, 0, 1]);
    expect(sameTeam(ctxOf(s), 0, 2)).toBe(true);
    expect(sameTeam(ctxOf(s), 0, 1)).toBe(false);
  });

  it('has no teams at all in a free-for-all', () => {
    const s = makeState({ hands: ['6C', '7C'], trump: 'S' });
    expect(teamOf(ctxOf(s), 0)).toBeNull();
    expect(sameTeam(ctxOf(s), 0, 1)).toBe(false);
  });
});

describe('partners', () => {
  it('never attack each other', () => {
    // Seat 1 defends; its partner is seat 3, who must sit the bout out.
    const s = makeState({
      hands: ['6C', '7C', '8C', '9C'],
      trump: 'S',
      attacker: 0,
      defender: 1,
      config: TEAMS,
    });
    expect(eligibleAttackers(ctxOf(s))).toEqual([0, 2]);
  });

  it('never transfer to each other', () => {
    // Seat 1 could transfer the six on to seat 2 — except seat 2 is not the
    // next player; that is seat 2's partner problem, so check the real case.
    const partnerNext = makeState({
      hands: ['KH', '6D 8C', '6H AC', 'QD'],
      trump: 'S',
      table: [['6C', null]],
      attacker: 0,
      defender: 1,
      config: { ...TEAMS, transfer: { enabled: true, withTrumpReveal: false, allowChains: true } },
    });
    // Seat 1's next player is seat 2, an opponent, so the transfer is fine.
    expect(legalMoves(ctxOf(partnerNext), 1).some((m) => m.t === 'TRANSFER')).toBe(true);

    // Now make seat 2 out, so the next player round is seat 3 — seat 1's partner.
    const partnerOnly = makeState({
      hands: ['KH', '6D 8C', '', 'QD AC'],
      trump: 'S',
      table: [['6C', null]],
      attacker: 0,
      defender: 1,
      config: { ...TEAMS, transfer: { enabled: true, withTrumpReveal: false, allowChains: true } },
    });
    partnerOnly.players[2]!.outAtStep = 1;
    expect(legalMoves(ctxOf(partnerOnly), 1).some((m) => m.t === 'TRANSFER')).toBe(false);
  });

  it('never end up facing each other after somebody goes out', () => {
    // Plain rotation would eventually pair partners, and a bout between
    // partners has no attackers at all — the game would simply stop.
    for (let seed = 0; seed < 200; seed++) {
      const config: RuleConfig = { ...DEFAULT_RULES, ...TEAMS };
      const out = playGame({ seed, players: 4, config, check: true });
      expect(out.state.phase).toBe('finished');
    }
  });
});

describe('ending a team game', () => {
  it('stops as soon as one side is out and blames that side', () => {
    // Seats 0 and 2 are team 0 and both empty their hands into one bout; seat 1
    // takes it. Team 0 is gone, so there is nothing left for team 1 to play
    // for even though both its members still hold cards.
    const s: GameState = makeState({
      hands: ['6C', '7C 7D', '6D', '9C 9D'],
      trump: 'S',
      attacker: 0,
      defender: 1,
      config: TEAMS,
    });

    const after = applyMoves(s, [
      { t: 'ATTACK', seat: 0, card: parseCardCode('6C') },
      { t: 'ATTACK', seat: 2, card: parseCardCode('6D') },
      { t: 'TAKE', seat: 1 },
    ]).state;

    expect(after.phase).toBe('finished');
    expect(after.result?.loserTeam).toBe(1);
    // Both losers are still holding cards — the loss is the side's, not one
    // unlucky player's.
    expect(after.players.filter((p) => p.outAtStep === null).map((p) => p.seat)).toEqual([1, 3]);
    expect(after.result?.durak).toBeNull();
  });

  it('reports no team in an ordinary game', () => {
    const s = makeState({ hands: ['6C', '7C', '8H'], trump: 'S', config: { handSize: 1 } });
    const after = applyMove(
      applyMove(s, { t: 'ATTACK', seat: 0, card: parseCardCode('6C') }).state,
      { t: 'DEFEND', seat: 1, card: parseCardCode('7C'), slot: 0 },
    ).state;
    expect(after.result?.loserTeam).toBeNull();
  });

  it('always names a losing side when teams are on', () => {
    for (let seed = 0; seed < 150; seed++) {
      const config: RuleConfig = { ...DEFAULT_RULES, ...TEAMS };
      const { state } = playGame({ seed, players: 4, config, check: false });
      const result = state.result!;
      if (result.reason === 'stalemate') continue;
      // Somebody was left holding cards, and they belong to a side.
      const stillHolding = state.players.filter((p) => p.outAtStep === null);
      if (stillHolding.length === 0) expect(result.loserTeam).toBeNull();
      else expect(result.loserTeam).not.toBeNull();
    }
  });
});

describe('configuration', () => {
  it('insists on exactly four players', () => {
    const config: RuleConfig = { ...DEFAULT_RULES, ...TEAMS };
    expect(validateConfig(config, 4).errors).toEqual([]);
    for (const players of [2, 3, 5]) {
      expect(validateConfig(config, players).errors.map((e) => e.code)).toContain('teams_need_four');
    }
  });

  it('points out that the attacker scope no longer means anything', () => {
    const config: RuleConfig = { ...DEFAULT_RULES, ...TEAMS, attackerScope: 'neighbours' };
    expect(validateConfig(config, 4).warnings.map((w) => w.code)).toContain('scope_ignored_in_teams');
  });

  it('is reachable from the random rule matrix, so the fuzzer covers it', () => {
    let sawTeams = false;
    for (let seed = 0; seed < 400 && !sawTeams; seed++) {
      sawTeams = randomSetup(seedRng(`matrix:${seed}`)).config.teams !== null;
    }
    expect(sawTeams).toBe(true);
  });
});
