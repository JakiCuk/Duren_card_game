import { describe, expect, it } from 'vitest';
import {
  BOT_CATALOGUE,
  createBot,
  createLevel1,
  createLevel2,
  isBotLevel,
  MAX_BOT_LEVEL,
  NoLegalMoveError,
  type BotLevel,
} from '../../src/bots/index.js';
import {
  moveKey,
  parseCardCode,
  redact,
  type PlayerView,
  type Seat,
} from '../../src/engine/index.js';
import { DEFAULT_RULES } from '../../src/shared/rules.js';
import { duel } from '../../tools/duel.js';
import { playBotGame } from '../../tools/sim.js';
import { makeState } from '../engine/helpers.js';

const LEVELS: BotLevel[] = [1, 2];

const viewOf = (spec: Parameters<typeof makeState>[0], seat: Seat): PlayerView =>
  redact(makeState(spec), seat);

describe('bot contract', () => {
  it('only ever proposes a move the view already offered', () => {
    for (const level of LEVELS) {
      for (let seed = 0; seed < 60; seed++) {
        // playBotGame validates every proposal against the redacted view and
        // throws otherwise, so simply completing the games is the assertion.
        const out = playBotGame({ seed, levels: [level, level], check: seed < 10 });
        expect(out.state.phase).toBe('finished');
      }
    }
  });

  it('plays legally in three- and four-handed games too', () => {
    for (let seed = 0; seed < 30; seed++) {
      expect(playBotGame({ seed, levels: [1, 2, 1] }).state.phase).toBe('finished');
      expect(playBotGame({ seed, levels: [2, 1, 2, 1] }).state.phase).toBe('finished');
    }
  });

  it('is reproducible: the same seed replays the same game', () => {
    for (let seed = 0; seed < 20; seed++) {
      const a = playBotGame({ seed, levels: [2, 1], check: false });
      const b = playBotGame({ seed, levels: [2, 1], check: false });
      expect(b.finalHash).toBe(a.finalHash);
      expect(b.moves.map(moveKey)).toEqual(a.moves.map(moveKey));
    }
  });

  it('refuses to invent a move when there is none', () => {
    const finished = redact(makeState({ hands: ['6C', '7C'], trump: 'S' }), 0);
    const stuck: PlayerView = { ...finished, legalMoves: [] };
    for (const level of LEVELS) {
      expect(() => createBot(level, 0, 1).chooseMove(stuck)).toThrow(NoLegalMoveError);
    }
  });

  it('falls back to the strongest built level instead of crashing', () => {
    expect(createBot(4, 0, 1).level).toBe(MAX_BOT_LEVEL);
    expect(isBotLevel(4)).toBe(true);
    expect(isBotLevel(5)).toBe(false);
  });

  it('advertises only the levels that exist', () => {
    const available = BOT_CATALOGUE.filter((b) => b.available).map((b) => b.level);
    expect(available).toEqual(LEVELS);
    expect(BOT_CATALOGUE.every((b) => b.nameKey.length > 0 && b.blurbKey.length > 0)).toBe(true);
  });
});

describe('level 1', () => {
  it('opens with its cheapest plain card and keeps its trumps', () => {
    const view = viewOf({ hands: ['6S 7C AD', 'KH'], trump: 'S' }, 0);
    expect(moveKey(createLevel1(0, 1).chooseMove(view))).toBe(
      moveKey({ t: 'ATTACK', seat: 0, card: parseCardCode('7C') }),
    );
  });

  it('leads a trump only when it holds nothing else', () => {
    const view = viewOf({ hands: ['6S 9S', 'KH'], trump: 'S' }, 0);
    expect(moveKey(createLevel1(0, 1).chooseMove(view))).toBe(
      moveKey({ t: 'ATTACK', seat: 0, card: parseCardCode('6S') }),
    );
  });

  it('covers with the cheapest plain card that beats', () => {
    const view = viewOf({ hands: ['KH', '8C 9C 6S'], trump: 'S', table: [['7C', null]] }, 1);
    expect(moveKey(createLevel1(1, 1).chooseMove(view))).toBe(
      moveKey({ t: 'DEFEND', seat: 1, card: parseCardCode('8C'), slot: 0 }),
    );
  });

  it('takes when nothing beats the attack', () => {
    const view = viewOf({ hands: ['KH', '6C 7D'], trump: 'S', table: [['AC', null]] }, 1);
    expect(createLevel1(1, 1).chooseMove(view).t).toBe('TAKE');
  });

  it('never throws a trump in', () => {
    const view = viewOf(
      { hands: ['6S 9D', 'KH AC'], trump: 'S', table: [['6C', null]], defenderHandAtBoutStart: 2 },
      0,
    );
    // The only rank-matching card is the six of trumps, so it passes instead.
    expect(createLevel1(0, 1).chooseMove(view).t).toBe('PASS');
  });
});

describe('level 2', () => {
  it('refuses to defend a bout it cannot win', () => {
    // The ace is unbeatable for us, so covering the seven would just throw a
    // card away before taking the pile anyway. Level 1 makes exactly that
    // mistake; level 2 must not.
    const spec = {
      hands: ['KH QH', '8C 6D'],
      trump: 'S',
      table: [['7C', null], ['AD', null]] as [string, string | null][],
      defenderHandAtBoutStart: 2,
    };
    expect(createLevel2(1, 1).chooseMove(viewOf(spec, 1)).t).toBe('TAKE');
    expect(createLevel1(1, 1).chooseMove(viewOf(spec, 1)).t).toBe('DEFEND');
  });

  it('spends a low trump on a six, but will not spend its best one', () => {
    const deck = '2C 3C 4C 5C 8D 9D TD JD QD KD 2H 3H 4H 5H 6H 7H 8H 9H TH JH 5S';
    const table: [string, string | null][] = [['6C', null]];
    const cheapTrump = viewOf(
      { hands: ['KH', '6S 7S AH'], trump: 'S', deck, table, config: { deckSize: 52 } },
      1,
    );
    const onlyTheAce = viewOf(
      { hands: ['KH', 'AS QH'], trump: 'S', deck, table, config: { deckSize: 52 } },
      1,
    );

    // A six of trumps is cheap enough to spend on a six.
    const cheap = createLevel2(1, 1).chooseMove(cheapTrump);
    expect(cheap.t).toBe('DEFEND');
    if (cheap.t === 'DEFEND') expect(cheap.card).toBe(parseCardCode('6S'));

    // The ace of trumps is not: swallowing one card costs less than the winner
    // it would burn, and the deck is still deep enough to recover.
    expect(createLevel2(1, 1).chooseMove(onlyTheAce).t).toBe('TAKE');
  });

  it('defends rather than takes once the deck is gone', () => {
    // With no deck left, absorbed cards can never be shed — taking is close to
    // losing outright, so the trump goes in.
    const view = viewOf({ hands: ['KH', '6S AH'], trump: 'S', table: [['6C', null]] }, 1);
    const move = createLevel2(1, 1).chooseMove(view);
    expect(move.t).toBe('DEFEND');
    if (move.t === 'DEFEND') expect(move.card).toBe(parseCardCode('6S'));
  });

  it('prefers opening with a rank it holds twice', () => {
    const view = viewOf({ hands: ['7C 7D 6H', 'KH'], trump: 'S' }, 0);
    const move = createLevel2(0, 1).chooseMove(view);
    expect(move.t).toBe('ATTACK');
    // The six is cheaper, but a pair of sevens guarantees a follow-up throw-in.
    if (move.t === 'ATTACK') expect([parseCardCode('7C'), parseCardCode('7D')]).toContain(move.card);
  });

  it('dumps junk onto a pile the defender has already conceded', () => {
    const view = viewOf(
      {
        hands: ['6C KC 9D', 'AH 2H'],
        trump: 'S',
        table: [['6D', null]],
        defenderTaking: true,
        defenderHandAtBoutStart: 4,
        config: { deckSize: 52 },
      },
      0,
    );
    const move = createLevel2(0, 1).chooseMove(view);
    expect(move.t).toBe('ATTACK');
    if (move.t === 'ATTACK') expect(move.card).toBe(parseCardCode('6C'));
  });
});

describe('strength ladder', () => {
  it('level 2 beats level 1 by a clear margin', () => {
    // Paired seeds: every deal is played twice with the seats swapped, so the
    // luck of the deal cancels and only the policies are being compared.
    const r = duel(createLevel2, createLevel1, 600, DEFAULT_RULES);
    expect(r.aScore).toBeGreaterThan(0.55);
    // The lower end of the confidence interval, not the point estimate — that
    // is what makes this a regression guard rather than a coin flip.
    expect(r.ci[0]).toBeGreaterThan(0.5);
  }, 60_000);
});
