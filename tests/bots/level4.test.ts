import { describe, expect, it } from 'vitest';
import { Belief, createLevel3, createLevel4, DECK, determinize } from '../../src/bots/index.js';
import { CountingMemory } from '../../src/bots/counting.js';
import {
  cardCode,
  moveKey,
  parseCardCode,
  redact,
  type PlayerView,
  type Seat,
} from '../../src/engine/index.js';
import { seedRng } from '../../src/engine/rng.js';
import { duel } from '../../tools/duel.js';
import { playBotGame, playGame } from '../../tools/sim.js';
import { makeState } from '../engine/helpers.js';

/** A memory and belief primed with what a watcher of this position would know. */
function primed(state: Parameters<typeof redact>[0], seat: Seat) {
  const memory = new CountingMemory(seat);
  const belief = new Belief(seat);
  const view = redact(state, seat);
  const events = [{ k: 'bito' as const, cards: [...state.discard] }];
  memory.observe(events, view);
  belief.observe(events, view);
  return { memory, belief, view };
}

describe('belief', () => {
  it('spreads probability over the cards nobody has placed', () => {
    const s = makeState({
      hands: ['6C 7C', '8C 9C'],
      deck: '6D 7D 8D 9D TS',
      attacker: 0,
      defender: 1,
      config: { handSize: 2 },
    });
    const { memory, belief, view } = primed(s, 0);
    const table = belief.fit(view, memory);

    // Two cards in the opponent's hand, four in the deck stub — so any given
    // unknown card is likelier to be in the deck than in their hand.
    let handTotal = 0;
    for (const card of table.unknown) handTotal += table.probability(1, card);
    expect(handTotal).toBeCloseTo(2, 5);
  });

  it('is certain about a card it watched somebody pick up', () => {
    const s = makeState({
      hands: ['6C 9D', '7D KH'],
      trump: 'S',
      attacker: 0,
      defender: 1,
      config: { handSize: 2 },
    });
    const memory = new CountingMemory(0);
    const belief = new Belief(0);
    const events = [
      { k: 'attack' as const, seat: 0, card: parseCardCode('6C'), throwIn: false },
      { k: 'take' as const, seat: 1, cards: [parseCardCode('6C')] },
    ];
    const view = redact(s, 0);
    memory.observe(events, view);
    belief.observe(events, view);

    expect(belief.fit(view, memory).probability(1, parseCardCode('6C'))).toBe(1);
  });

  it('lowers the odds on cards a player declined to use', () => {
    // Trump is diamonds, so every diamond in the pool beats a six of clubs and
    // every heart does not. Seat 1 took rather than beat it, which should push
    // probability off the diamonds and onto the hearts.
    const s = makeState({
      hands: ['6C 7C', '8C 9C'],
      deck: '9D TD JD QD 2H 3H 4H 5D',
      attacker: 0,
      defender: 1,
      config: { handSize: 2, deckSize: 52 },
    });
    const view = redact(s, 0);
    const memory = new CountingMemory(0);
    memory.observe([{ k: 'bito', cards: [...s.discard] }], view);

    const plain = new Belief(0);
    plain.observe([{ k: 'bito', cards: [...s.discard] }], view);
    const before = plain.fit(view, memory);

    const informed = new Belief(0);
    informed.observe(
      [
        { k: 'bito', cards: [...s.discard] },
        { k: 'attack', seat: 0, card: parseCardCode('6C'), throwIn: false },
        { k: 'takeDeclared', seat: 1 },
      ],
      view,
    );
    const after = informed.fit(view, memory);

    expect(after.probability(1, parseCardCode('QD'))).toBeLessThan(
      before.probability(1, parseCardCode('QD')),
    );
    // The mass has to go somewhere, and the hearts are where.
    expect(after.probability(1, parseCardCode('3H'))).toBeGreaterThan(
      before.probability(1, parseCardCode('3H')),
    );
  });

  it('forgets what it inferred once a player draws fresh cards', () => {
    // Half a new hand is unconstrained by anything observed before it; without
    // this the model becomes confidently wrong within a few bouts.
    const s = makeState({
      hands: ['6C 7C', '8C 9C'],
      deck: '9D TD JD QD 2H 3H 4H 5D',
      attacker: 0,
      defender: 1,
      config: { handSize: 2, deckSize: 52 },
    });
    const view = redact(s, 0);
    const memory = new CountingMemory(0);
    memory.observe([{ k: 'bito', cards: [...s.discard] }], view);

    const belief = new Belief(0);
    const seen = [
      { k: 'bito' as const, cards: [...s.discard] },
      { k: 'attack' as const, seat: 0 as Seat, card: parseCardCode('6C'), throwIn: false },
      { k: 'takeDeclared' as const, seat: 1 as Seat },
    ];
    belief.observe(seen, view);
    const suspicious = belief.fit(view, memory).probability(1, parseCardCode('QD'));

    belief.observe([{ k: 'draw', seat: 1, count: 2, cards: null }], view);
    const refreshed = belief.fit(view, memory).probability(1, parseCardCode('QD'));

    expect(refreshed).toBeGreaterThan(suspicious);
  });
});

describe('determinization', () => {
  it('produces a deal that matches every published hand size', () => {
    for (let seed = 0; seed < 30; seed++) {
      const s = makeState({
        hands: ['6C 7C', '8C 9C', 'TC JC'],
        deck: '6D 7D 8D 9D TD JD QD KD AD 2H TS',
        attacker: 0,
        defender: 1,
        config: { handSize: 2, deckSize: 52 },
      });
      const { memory, belief, view } = primed(s, 0);
      const deal = determinize(view, memory, belief.fit(view, memory), seedRng(seed));
      expect(deal, `seed ${seed}`).not.toBeNull();
      for (const p of view.players) {
        expect(deal!.players[p.seat]!.hand).toHaveLength(p.handCount);
      }
    }
  });

  it('always gives us back our own hand, never a guess at it', () => {
    const s = makeState({
      hands: ['6C 7C', '8C 9C'],
      deck: '6D 7D 8D 9D TS',
      attacker: 0,
      defender: 1,
      config: { handSize: 2 },
    });
    const { memory, belief, view } = primed(s, 0);
    const deal = determinize(view, memory, belief.fit(view, memory), seedRng(1))!;
    expect(deal.players[0]!.hand).toEqual(view.you!.hand);
  });

  it('never invents a card that is already accounted for', () => {
    const s = makeState({
      hands: ['6C 7C', '8C 9C'],
      deck: '6D 7D 8D 9D TS',
      attacker: 0,
      defender: 1,
      config: { handSize: 2 },
    });
    const { memory, belief, view } = primed(s, 0);
    const deal = determinize(view, memory, belief.fit(view, memory), seedRng(2))!;

    const all = [...deal.players.flatMap((p) => p.hand), ...deal.deck, ...deal.discard];
    expect(new Set(all).size).toBe(all.length);
  });

  it('honours what it knows for certain', () => {
    const s = makeState({
      hands: ['6C 9D', '7D KH'],
      trump: 'S',
      deck: '8H 9H TH JH TS',
      attacker: 0,
      defender: 1,
      config: { handSize: 2 },
    });
    const memory = new CountingMemory(0);
    const belief = new Belief(0);
    const events = [
      { k: 'bito' as const, cards: [...s.discard] },
      { k: 'take' as const, seat: 1 as Seat, cards: [parseCardCode('7D')] },
    ];
    const view = redact(s, 0);
    memory.observe(events, view);
    belief.observe(events, view);

    for (let seed = 0; seed < 10; seed++) {
      const deal = determinize(view, memory, belief.fit(view, memory), seedRng(seed));
      // A card we watched go into that hand must be in that hand, every time.
      expect(deal?.players[1]!.hand).toContain(parseCardCode('7D'));
    }
  });
});

describe('level 4', () => {
  it('plays legally at every table size', () => {
    for (let seed = 0; seed < 6; seed++) {
      expect(playBotGame({ seed, levels: [4, 3] }).state.phase).toBe('finished');
      expect(playBotGame({ seed, levels: [4, 2, 1] }).state.phase).toBe('finished');
    }
  }, 120_000);

  it('is reproducible from its seed', () => {
    for (let seed = 0; seed < 4; seed++) {
      expect(playBotGame({ seed, levels: [4, 2], check: false }).finalHash).toBe(
        playBotGame({ seed, levels: [4, 2], check: false }).finalHash,
      );
    }
  }, 120_000);

  it('still solves an endgame exactly instead of sampling it', () => {
    const s = makeState({
      hands: ['6C AS', '7C'],
      trump: 'S',
      attacker: 0,
      defender: 1,
      config: { handSize: 2 },
    });
    const bot = createLevel4(0, 'endgame');
    // Events observed before the first view must not be lost — the deal itself
    // arrives that way, and so does everything beaten before our first turn.
    bot.observe([{ k: 'bito', cards: [...s.discard] }]);

    const move = bot.chooseMove(redact(s, 0));
    expect(move.t).toBe('ATTACK');
    if (move.t === 'ATTACK') expect(cardCode(move.card)).toBe('AS');
  });

  it('decides within a bounded time', () => {
    // The budget is a sample count, not a clock, so this is a sanity check on
    // the constant rather than a timing guarantee — but a level that took a
    // second per move would make a live room unplayable.
    const bot = createLevel4(0, 'timing');
    let worst = 0;
    let decisions = 0;

    playGame({
      seed: 7,
      players: 2,
      check: false,
      choosers: [
        (view: PlayerView) => {
          const started = performance.now();
          const move = bot.chooseMove(view);
          worst = Math.max(worst, performance.now() - started);
          decisions++;
          return move;
        },
      ],
      onEvents: (seat, events) => {
        if (seat === 0) bot.observe(events);
      },
    });

    expect(decisions).toBeGreaterThan(3);
    expect(worst).toBeLessThan(400);
  }, 60_000);

  it('beats level 3 by a clear margin', () => {
    const r = duel(createLevel4, createLevel3, 60);
    expect(r.aScore).toBeGreaterThan(0.55);
  }, 300_000);

  it('is deterministic given its seed, and says so', () => {
    // The softmax over near-equal moves is deliberately mild: turning it up
    // enough to be genuinely unpredictable costs about fifteen points of win
    // rate. So the bot is reproducible, and a human who replays the same
    // position will see the same answer.
    const line = (botSeed: string): string =>
      playGame({
        seed: 11,
        players: 2,
        check: false,
        choosers: [
          (() => {
            const bot = createLevel4(0, botSeed);
            return (view: PlayerView) => bot.chooseMove(view);
          })(),
          (() => {
            const bot = createLevel3(1, 'fixed');
            return (view: PlayerView) => bot.chooseMove(view);
          })(),
        ],
      })
        .moves.map(moveKey)
        .join(' ');

    expect(line('same')).toBe(line('same'));
  }, 120_000);
});

describe('the belief table', () => {
  it('treats the deck as just another holder', () => {
    const s = makeState({
      hands: ['6C 7C', '8C 9C'],
      deck: '6D 7D 8D 9D TS',
      attacker: 0,
      defender: 1,
      config: { handSize: 2 },
    });
    const { memory, belief, view } = primed(s, 0);
    const table = belief.fit(view, memory);
    expect(table.holders).toContain(DECK);
    // Every unknown card is somewhere, so its probabilities sum to one.
    for (const card of table.unknown) {
      const total = table.holders.reduce((sum, h) => sum + table.probability(h, card), 0);
      expect(total).toBeCloseTo(1, 5);
    }
  });
});
