import { describe, expect, it } from 'vitest';
import {
  applyMoves,
  assertInvariants,
  checkInvariants,
  createGame,
  hashState,
} from '../../src/engine/index.js';
import { DEFAULT_RULES, type RuleConfig } from '../../src/shared/rules.js';
import { MAX_STEPS, playRandomGame } from '../../tools/sim.js';

const replay = (outcome: ReturnType<typeof playRandomGame>) => {
  const fresh = createGame({
    players: outcome.playerIds,
    config: outcome.config,
    seed: outcome.seed,
  }).state;
  return applyMoves(fresh, outcome.moves).state;
};

describe('determinism', () => {
  it('reproduces a game exactly from (config, seed, moves)', () => {
    for (let seed = 0; seed < 40; seed++) {
      const outcome = playRandomGame({ seed, players: 3, check: false });
      expect(hashState(replay(outcome)), `seed ${seed}`).toBe(outcome.finalHash);
    }
  });

  it('gives different seeds different games', () => {
    const hashes = new Set(
      Array.from({ length: 200 }, (_, seed) => playRandomGame({ seed, players: 2, check: false }).finalHash),
    );
    expect(hashes.size).toBeGreaterThan(150);
  });

  it('hashes the parts of the state that matter', () => {
    const a = createGame({ players: ['a', 'b'], config: DEFAULT_RULES, seed: 5 }).state;
    const b = createGame({ players: ['a', 'b'], config: DEFAULT_RULES, seed: 5 }).state;
    expect(hashState(a)).toBe(hashState(b));

    b.players[0]!.hand = [...b.players[0]!.hand].reverse();
    expect(hashState(b), 'card order inside a hand must be visible to the hash').not.toBe(hashState(a));
  });
});

describe('invariants under random play', () => {
  const configs: { name: string; config: RuleConfig; players: number }[] = [
    { name: '2p / 36 cards', config: DEFAULT_RULES, players: 2 },
    { name: '3p / 36 cards', config: DEFAULT_RULES, players: 3 },
    { name: '5p / 36 cards', config: DEFAULT_RULES, players: 5 },
    { name: '2p / 52 cards', config: { ...DEFAULT_RULES, deckSize: 52 }, players: 2 },
    { name: '6p / 52 cards', config: { ...DEFAULT_RULES, deckSize: 52 }, players: 6 },
    {
      name: '4p / no throw-in after take',
      config: { ...DEFAULT_RULES, throwInAfterTake: false },
      players: 4,
    },
    {
      name: '3p / first bout capped, random opener, hidden trump',
      config: {
        ...DEFAULT_RULES,
        firstBoutCapFive: true,
        firstAttacker: 'random',
        trumpCardVisible: false,
      },
      players: 3,
    },
    { name: '2p / four-card hands', config: { ...DEFAULT_RULES, handSize: 4 }, players: 2 },
  ];

  for (const { name, config, players } of configs) {
    it(`holds across 300 random games — ${name}`, () => {
      for (let seed = 0; seed < 300; seed++) {
        const outcome = playRandomGame({ seed, players, config, check: true });
        expect(outcome.steps, `seed ${seed} looks like a livelock`).toBeLessThan(MAX_STEPS);
        expect(checkInvariants(outcome.state), `seed ${seed}`).toEqual([]);
        expect(outcome.state.phase).toBe('finished');
      }
    });
  }

  it('always ends with either a durak or an explicit draw', () => {
    for (let seed = 0; seed < 300; seed++) {
      const { state } = playRandomGame({ seed, players: 4, check: false });
      const result = state.result!;
      expect(result).not.toBeNull();
      const stillHolding = state.players.filter((p) => p.outAtStep === null);
      if (result.durak === null) {
        expect(stillHolding).toHaveLength(0);
      } else {
        expect(stillHolding.map((p) => p.id)).toEqual([result.durak]);
      }
      // Everyone is accounted for exactly once.
      const named = new Set([...result.order, ...(result.durak === null ? [] : [result.durak])]);
      expect(named.size).toBe(state.players.length);
      assertInvariants(state, `seed ${seed}`);
    }
  });
});
