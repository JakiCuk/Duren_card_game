import { describe, expect, it } from 'vitest';
import {
  applyMove,
  cardCode,
  createGame,
  ctxOf,
  legalMoves,
  moveKey,
  parseCardCode,
  redact,
  redactEvent,
  redactEvents,
  viewCtx,
  type CardId,
  type GameState,
  type Seat,
} from '../../src/engine/index.js';
import { DEFAULT_RULES } from '../../src/shared/rules.js';
import { playGame } from '../../tools/sim.js';
import { makeState } from './helpers.js';

const deal = (players: number, seed: number | string): GameState =>
  createGame({
    players: Array.from({ length: players }, (_, i) => `p${i}`),
    config: DEFAULT_RULES,
    seed,
  }).state;

/** Cards the viewer is entitled to see: their own hand and the visible trump. */
function permitted(state: GameState, viewer: Seat): Set<CardId> {
  const ok = new Set<CardId>(state.players[viewer]!.hand);
  for (const slot of state.table) {
    ok.add(slot.attack);
    if (slot.defence !== null) ok.add(slot.defence);
  }
  for (const c of state.discard) ok.add(c);
  if (state.config.trumpCardVisible && state.trumpCard !== null) ok.add(state.trumpCard);
  return ok;
}

describe('redaction', () => {
  /**
   * Every field of the view that is allowed to carry a card id. Anything not
   * listed here must not contain one — and the shape test below makes adding a
   * new field to `PlayerView` fail until somebody decides which list it joins.
   */
  const cardsIn = (view: ReturnType<typeof redact>): CardId[] => [
    ...(view.trumpCard === null ? [] : [view.trumpCard]),
    ...(view.you?.hand ?? []),
    ...view.table.flatMap((t) => (t.defence === null ? [t.attack] : [t.attack, t.defence])),
    ...view.legalMoves.flatMap((m) => ('card' in m ? [m.card] : [])),
  ];

  it('exposes no card the viewer is not entitled to see', () => {
    for (let seed = 0; seed < 80; seed++) {
      // Sample mid-game states, not just finished ones: hands are empty at the
      // end, which is exactly when a leak test proves nothing.
      const outcome = playGame({ seed, players: 3, check: false });
      const states = [outcome.state];
      let replay = deal(3, seed);
      for (const move of outcome.moves.slice(0, 20)) {
        replay = applyMove(replay, move).state;
        states.push(replay);
      }

      for (const state of states) {
        for (const viewer of [0, 1, 2]) {
          const allowed = permitted(state, viewer);
          for (const card of cardsIn(redact(state, viewer))) {
            expect(allowed.has(card), `seed ${seed}: seat ${viewer} can see ${cardCode(card)}`).toBe(true);
          }
        }
      }
    }
  });

  it('keeps foreign hands, the deck and the discard out of the payload', () => {
    const state = deal(4, 42);
    const view = redact(state, 1);
    const json = JSON.stringify(view);

    expect(view.you?.seat).toBe(1);
    expect(view.players.every((p) => !('hand' in p))).toBe(true);
    expect(json).not.toContain('"deck"');
    expect(json).not.toContain('"discard"');
    expect(json).not.toContain('"rng"');
    expect(json).not.toContain('"outAtStep"');
  });

  it('has exactly the fields the leak check knows about', () => {
    // A new field on PlayerView trips this deliberately: whoever adds one has
    // to decide whether it can carry a card, and extend `cardsIn` if it can.
    expect(Object.keys(redact(deal(2, 1), 0)).sort()).toEqual(
      [
        'attackerSeat',
        'boutIndex',
        'config',
        'deckCount',
        'defenderHandAtBoutStart',
        'defenderSeat',
        'defenderTaking',
        'discardCount',
        'finished',
        'legalMoves',
        'players',
        'result',
        'seq',
        'table',
        'trump',
        'trumpCard',
        'you',
      ].sort(),
    );
  });

  it('publishes only counts for the deck and the discard pile', () => {
    const state = deal(2, 7);
    const view = redact(state, 0);
    expect(view.deckCount).toBe(state.deck.length);
    expect(view.discardCount).toBe(state.discard.length);
    expect(Object.keys(view)).not.toContain('deck');
    expect(Object.keys(view)).not.toContain('discard');
  });

  it('hides the bottom card when the rules say it is face down', () => {
    const visible = makeState({ hands: ['6C', '7D'], deck: '9C TS', trump: 'S' });
    const hidden = makeState({
      hands: ['6C', '7D'],
      deck: '9C TS',
      trump: 'S',
      config: { trumpCardVisible: false },
    });
    expect(redact(visible, 0).trumpCard).toBe(parseCardCode('TS'));
    expect(redact(hidden, 0).trumpCard).toBeNull();
    // The suit is common knowledge either way — only the card is not.
    expect(redact(hidden, 0).trump).toBe(3);
  });

  it('gives a spectator no hand and no moves', () => {
    const view = redact(deal(2, 3), null);
    expect(view.you).toBeNull();
    expect(view.legalMoves).toEqual([]);
    expect(view.players).toHaveLength(2);
  });
});

describe('the view runs the same rules as the server', () => {
  it('agrees with the authoritative legal move list on every move of a game', () => {
    for (let seed = 0; seed < 25; seed++) {
      let state = deal(3, seed);
      for (let step = 0; step < 120 && state.phase === 'bout'; step++) {
        for (const seat of [0, 1, 2]) {
          const fromState = legalMoves(ctxOf(state), seat).map(moveKey).sort();
          const view = redact(state, seat);
          const fromView = legalMoves(viewCtx(view), seat).map(moveKey).sort();
          expect(fromView, `seed ${seed} seat ${seat}`).toEqual(fromState);
          expect(view.legalMoves.map(moveKey).sort()).toEqual(fromState);
        }
        const next = redact(state, 0).legalMoves[0] ?? legalMoves(ctxOf(state), 1)[0] ?? legalMoves(ctxOf(state), 2)[0];
        if (!next) break;
        state = applyMove(state, next).state;
      }
    }
  });

  it('refuses to enumerate moves for a seat it cannot see', () => {
    const view = redact(deal(3, 1), 0);
    expect(() => legalMoves(viewCtx(view), 1)).toThrow(/hidden/);
  });
});

describe('event redaction', () => {
  it('shows a player only their own dealt hand', () => {
    const { state, events } = createGame({ players: ['a', 'b'], config: DEFAULT_RULES, seed: 11 });
    const forSeat0 = redactEvent(events[0]!, 0);
    const forSeat1 = redactEvent(events[0]!, 1);
    expect(forSeat0).toMatchObject({ k: 'dealt', hand: state.players[0]!.hand });
    expect(forSeat1).toMatchObject({ k: 'dealt', hand: state.players[1]!.hand });
    expect(redactEvent(events[0]!, null)).toMatchObject({ k: 'dealt', hand: null });
  });

  it('shows drawn cards only to the player who drew them', () => {
    const s = makeState({
      hands: ['6C', '7D', '8H'],
      deck: '9C TD JH',
      attacker: 0,
      defender: 1,
      config: { handSize: 2 },
    });
    const after = applyMove(applyMove(s, { t: 'ATTACK', seat: 0, card: parseCardCode('6C') }).state, {
      t: 'TAKE',
      seat: 1,
    });
    const draws = after.events.filter((e) => e.k === 'draw');
    expect(draws.length).toBeGreaterThan(0);

    for (const e of draws) {
      const mine = redactEvent(e, e.seat);
      const theirs = redactEvent(e, e.seat === 0 ? 1 : 0);
      expect(mine).toMatchObject({ k: 'draw', cards: expect.any(Array) as unknown });
      expect(theirs).toMatchObject({ k: 'draw', cards: null });
      // The count is public — everyone watches how many cards you take.
      if (theirs.k === 'draw' && mine.k === 'draw') expect(theirs.count).toBe(mine.count);
    }
  });

  it('strips the forced-pass flag, which would otherwise be a tell', () => {
    // An auto-pass proves the player holds no card of any rank on the table.
    // A deliberate pass proves nothing. Publishing the difference would hand
    // every observer information a real table does not give them.
    const s = makeState({
      hands: ['6C 9D', '7C KH'],
      trump: 'S',
      attacker: 0,
      defender: 1,
      config: { handSize: 2 },
    });
    const { events } = applyMove(s, { t: 'ATTACK', seat: 0, card: parseCardCode('6C') });
    const passes = events.filter((e) => e.k === 'pass');
    expect(passes[0]).toMatchObject({ auto: true });
    expect(redactEvent(passes[0]!, 1)).toEqual({ k: 'pass', seat: 0 });
    expect(JSON.stringify(redactEvents(events, 1))).not.toContain('auto');
  });

  it('leaves fully public events untouched', () => {
    const s = makeState({ hands: ['6C 7C', 'AC'], trump: 'S' });
    const { events } = applyMove(s, { t: 'ATTACK', seat: 0, card: parseCardCode('6C') });
    const attack = events.find((e) => e.k === 'attack')!;
    expect(redactEvent(attack, 1)).toEqual(attack);
  });
});
