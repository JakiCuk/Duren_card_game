import { describe, expect, it } from 'vitest';
import { CountingMemory, createLevel3, solveEndgame } from '../../src/bots/index.js';
import { atLeastOne, expectedCount } from '../../src/bots/probability.js';
import {
  applyMove,
  cardCode,
  fullDeck,
  parseCardCode,
  redact,
  redactEvents,
  type GameState,
  type Move,
  type PlayerView,
  type Seat,
} from '../../src/engine/index.js';
import { duel } from '../../tools/duel.js';
import { playBotGame, playGame } from '../../tools/sim.js';
import { createLevel2 } from '../../src/bots/level2.js';
import { makeState } from '../engine/helpers.js';

/** Feeds a scripted game to a memory the way the client would. */
function watch(state: GameState, moves: Move[], seat: Seat): { memory: CountingMemory; view: PlayerView } {
  const memory = new CountingMemory(seat);
  let current = state;
  for (const move of moves) {
    const applied = applyMove(current, move);
    current = applied.state;
    memory.observe(redactEvents(applied.events, seat), redact(current, seat));
  }
  return { memory, view: redact(current, seat) };
}

const codes = (cards: readonly number[]): string[] => cards.map(cardCode).sort();

/**
 * A memory primed with what a watcher of this position would already know.
 *
 * `makeState` sweeps every unused card into the discard; a real bot would have
 * watched those go by as `bito` events, so replaying one is not a shortcut past
 * the redaction — it is the same information arriving the same way.
 */
function memoryFor(state: GameState, seat: Seat): { memory: CountingMemory; view: PlayerView } {
  const memory = new CountingMemory(seat);
  const view = redact(state, seat);
  memory.observe([{ k: 'bito', cards: [...state.discard] }], view);
  return { memory, view };
}

describe('counting memory', () => {
  it('rebuilds the discard pile from the event log', () => {
    // The wire only carries the size of the discard, so anything the bot knows
    // about it, it worked out by watching.
    const s = makeState({
      hands: ['6C 8D', '7C 9D'],
      deck: '6H 7H 8H 9H TS',
      attacker: 0,
      defender: 1,
      config: { handSize: 2 },
    });
    const { memory, view } = watch(s, [
      { t: 'ATTACK', seat: 0, card: parseCardCode('6C') },
      { t: 'DEFEND', seat: 1, card: parseCardCode('7C'), slot: 0 },
    ], 0);

    const pool = memory.unknownPool(view);
    expect(codes(pool)).not.toContain('6C');
    expect(codes(pool)).not.toContain('7C');
  });

  it('remembers exactly which cards a player picked up', () => {
    const s = makeState({
      hands: ['6C 9D', '7D KH'],
      trump: 'S',
      attacker: 0,
      defender: 1,
      config: { handSize: 2 },
    });
    const { memory } = watch(s, [
      { t: 'ATTACK', seat: 0, card: parseCardCode('6C') },
      { t: 'TAKE', seat: 1 },
    ], 0);

    // Everybody watched that six go into seat 1's hand.
    expect(codes(memory.cardsKnownIn(1))).toEqual(['6C']);
  });

  it('forgets a card once its holder plays it again', () => {
    const s = makeState({
      hands: ['5C 6C', '9D'],
      trump: 'S',
      attacker: 0,
      defender: 1,
      config: { handSize: 2, deckSize: 52 },
    });

    const taken = watch(s, [
      { t: 'ATTACK', seat: 0, card: parseCardCode('6C') },
      { t: 'TAKE', seat: 1 },
    ], 0);
    expect(codes(taken.memory.cardsKnownIn(1))).toEqual(['6C']);

    // Seat 1 now beats a five with the very six it picked up, so the card is
    // on the table rather than in hand and the memory has to let go of it.
    const after = watch(s, [
      { t: 'ATTACK', seat: 0, card: parseCardCode('6C') },
      { t: 'TAKE', seat: 1 },
      { t: 'ATTACK', seat: 0, card: parseCardCode('5C') },
      { t: 'DEFEND', seat: 1, card: parseCardCode('6C'), slot: 0 },
    ], 0);
    expect(after.memory.cardsKnownIn(1)).not.toContain(parseCardCode('6C'));
  });

  it('never places our own cards in the unknown pool', () => {
    const s = makeState({ hands: ['6C 8D AS', '7C 9D KH'], trump: 'S', config: { handSize: 3 } });
    const memory = new CountingMemory(0);
    const view = redact(s, 0);
    memory.observe([], view);
    for (const card of view.you!.hand) expect(memory.unknownPool(view)).not.toContain(card);
  });

  it('accounts for every card exactly once, all game long', () => {
    for (let seed = 0; seed < 15; seed++) {
      const memory = new CountingMemory(0);
      let latest: PlayerView | null = null;

      playGame({
        seed,
        players: 2,
        check: false,
        onEvents: (seat, events) => {
          if (seat !== 0) return;
          // The view the bot would be holding when those events arrived.
          if (latest !== null) memory.observe(events, latest);
        },
        choosers: [
          (view) => {
            latest = view;
            memory.observe([], view);
            const total =
              (view.you?.hand.length ?? 0) +
              view.table.reduce((n, t) => n + (t.defence === null ? 1 : 2), 0) +
              view.discardCount +
              memory.unknownPool(view).length +
              [...memory.knownHeld.values()].reduce((n, set) => n + set.size, 0) +
              // The face-up bottom card is neither unknown nor in anybody's
              // hand: its identity and its position are both public.
              (view.trumpCard === null ? 0 : 1);
            // Nothing is counted twice and nothing goes missing.
            expect(total, `seed ${seed}`).toBe(fullDeck(view.config.deckSize).length);
            return view.legalMoves[0]!;
          },
        ],
      });
    }
  });

  it('knows when a card cannot be beaten any more', () => {
    // Everything is discarded except our ace of trumps and the opponent's king,
    // so the king is the only card anybody could still beat something with.
    const s = makeState({ hands: ['AS', 'KS'], trump: 'S', config: { handSize: 1 } });
    const { memory, view } = memoryFor(s, 0);

    expect(memory.isUnbeatable(view, parseCardCode('AS'))).toBe(true);
    // The queen is beatable — by the king we know is out there.
    expect(memory.isUnbeatable(view, parseCardCode('QS'))).toBe(false);
    // "Unbeatable" means by an *opponent*: our own ace does not count against us.
    expect(memory.isUnbeatable(view, parseCardCode('KS'))).toBe(true);
  });
});

describe('hypergeometric helpers', () => {
  it('is certain when every card in the pool qualifies', () => {
    expect(atLeastOne(10, 10, 3)).toBe(1);
  });

  it('is impossible when none does', () => {
    expect(atLeastOne(10, 0, 3)).toBe(0);
  });

  it('matches the hand-computed value on a small case', () => {
    // Pool of 4, one favourable, hand of 2: 1 − C(3,2)/C(4,2) = 1 − 3/6 = 0.5.
    expect(atLeastOne(4, 1, 2)).toBeCloseTo(0.5, 10);
  });

  it('rises with the hand size', () => {
    const small = atLeastOne(20, 4, 2);
    const large = atLeastOne(20, 4, 6);
    expect(large).toBeGreaterThan(small);
  });

  it('averages the way sampling without replacement does', () => {
    expect(expectedCount(20, 4, 5)).toBeCloseTo(1, 10);
  });
});

describe('endgame solver', () => {
  it('finds the winning line when one exists', () => {
    // Heads-up, deck empty: seat 0 holds the ace of trumps and a six; seat 1
    // holds a seven. Attacking with the six loses it to the seven, so the ace
    // must lead — then seat 1 cannot answer and takes, leaving them holding
    // cards while seat 0 goes out.
    const s = makeState({
      hands: ['6C AS', '7C'],
      trump: 'S',
      attacker: 0,
      defender: 1,
      config: { handSize: 2 },
    });
    const { memory, view } = memoryFor(s, 0);
    const solved = solveEndgame(view, memory);
    expect(solved).not.toBeNull();
    expect(solved!.value).toBe(1);
    expect(solved!.move.t).toBe('ATTACK');
    if (solved!.move.t === 'ATTACK') expect(cardCode(solved!.move.card)).toBe('AS');
  });

  it('declines to solve while cards are still hidden', () => {
    const s = makeState({
      hands: ['6C AS', '7C'],
      deck: '8C 9C TS',
      attacker: 0,
      defender: 1,
      config: { handSize: 2 },
    });
    const { memory, view } = memoryFor(s, 0);
    // With a deck left, the opponent's hand is a guess — and a solver that
    // guesses is not a solver.
    expect(solveEndgame(view, memory)).toBeNull();
  });

  it('only ever returns a move for its own seat', () => {
    for (let seed = 0; seed < 40; seed++) {
      const out = playBotGame({ seed, levels: [3, 3], check: false });
      expect(out.state.phase).toBe('finished');
    }
  });
});

describe('level 3', () => {
  it('plays legally in every table size', () => {
    for (let seed = 0; seed < 20; seed++) {
      expect(playBotGame({ seed, levels: [3, 2] }).state.phase).toBe('finished');
      expect(playBotGame({ seed, levels: [3, 2, 1] }).state.phase).toBe('finished');
      expect(playBotGame({ seed, levels: [3, 1, 3, 2] }).state.phase).toBe('finished');
    }
  });

  it('is reproducible', () => {
    for (let seed = 0; seed < 10; seed++) {
      expect(playBotGame({ seed, levels: [3, 2], check: false }).finalHash).toBe(
        playBotGame({ seed, levels: [3, 2], check: false }).finalHash,
      );
    }
  });

  it('beats level 2 by a clear margin', () => {
    const r = duel(
      (seat, seed) => createLevel3(seat, seed),
      (seat, seed) => createLevel2(seat, seed),
      160,
    );
    expect(r.aScore).toBeGreaterThan(0.55);
    expect(r.ci[0]).toBeGreaterThan(0.5);
  }, 120_000);
});
