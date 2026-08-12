// @vitest-environment jsdom
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Board } from '../../src/client/game/Board.js';
import { modelFromState, modelFromView } from '../../src/client/game/model.js';
import { redact, type Seat } from '../../src/engine/index.js';
import { makeState } from '../engine/helpers.js';
import { renderWithI18n } from './render.js';

afterEach(cleanup);

/** The seat drawn along the bottom edge — the one whose cards you can play. */
const seatedAtTheBottom = (): string =>
  document.querySelector('.seat--me .seat__name')?.textContent ?? '';

const namesAcross = (): string[] =>
  Array.from(document.querySelectorAll('.seat--across .seat__name')).map((el) => el.textContent ?? '');

const state = () =>
  makeState({
    hands: ['6C 7C 8C', 'TC JC QC'],
    deck: '9D TD JD QD KD AD 2H 3H TS',
    attacker: 0,
    defender: 1,
    config: { handSize: 3, deckSize: 52 },
  });

describe('who sits at the bottom', () => {
  it('seats the joining player in their own chair, not the host in it', () => {
    // Regression: the table anchored on "whoever can move", so a player who was
    // not on turn was drawn as a small opponent at the top while the host took
    // the bottom seat — complete with the host's face-down cards.
    const view = redact(state(), 1);
    const model = modelFromView(view, {
      seatName: (s: Seat) => (s === 0 ? 'Roman' : 'Denis'),
      isBot: () => false,
      connected: () => true,
      substituted: () => false,
    });

    // It is seat 0's turn, so seat 1 has nothing to do — and must still be
    // sitting at the bottom.
    expect(model.controllable).toEqual([]);
    expect(model.mySeat).toBe(1);

    renderWithI18n(<Board model={model} play={() => {}} />);
    expect(seatedAtTheBottom()).toBe('Denis');
    expect(namesAcross()).toEqual(['Roman']);
  });

  it('shows you your own cards and nobody else’s', () => {
    const view = redact(state(), 1);
    const model = modelFromView(view, {
      seatName: (s: Seat) => (s === 0 ? 'Roman' : 'Denis'),
      isBot: () => false,
      connected: () => true,
      substituted: () => false,
    });
    renderWithI18n(<Board model={model} play={() => {}} />);

    const mine = Array.from(document.querySelectorAll('.seat--me .hand .card img'));
    expect(mine).toHaveLength(3);
    expect(mine.every((img) => img.getAttribute('alt') !== 'Rubová strana')).toBe(true);

    const theirs = Array.from(document.querySelectorAll('.seat--across .hand .card img'));
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.every((img) => img.getAttribute('alt') === 'Rubová strana')).toBe(true);
  });

  it('keeps your chair when the turn passes to somebody else', () => {
    const first = redact(state(), 1);
    const options = {
      seatName: (s: Seat) => (s === 0 ? 'Roman' : 'Denis'),
      isBot: () => false,
      connected: () => true,
      substituted: () => false,
    };
    const { rerender } = renderWithI18n(
      <Board model={modelFromView(first, options)} play={() => {}} />,
    );
    expect(seatedAtTheBottom()).toBe('Denis');

    // Now it is our turn: same chair, more to do.
    const onTurn = redact(
      makeState({
        // Seat 0 has played its six, so the card is on the table, not in hand.
        hands: ['7C 8C', 'TC JC QC'],
        deck: '9D TD JD QD KD AD 2H 3H TS',
        table: [['6C', null]],
        attacker: 0,
        defender: 1,
        config: { handSize: 3, deckSize: 52 },
      }),
      1,
    );
    rerender(<Board model={modelFromView(onTurn, options)} play={() => {}} />);
    expect(seatedAtTheBottom()).toBe('Denis');
  });

  it('still follows the device in a hot-seat game', () => {
    // With no fixed owner the table rotates to whoever can act, which is what
    // makes passing one laptop around workable.
    const model = modelFromState(state(), {
      seatName: (s: Seat) => `Hráč ${s + 1}`,
      isBot: (s) => s === 1,
    });
    expect(model.mySeat).toBeNull();

    renderWithI18n(<Board model={model} play={() => {}} />);
    expect(seatedAtTheBottom()).toBe('Hráč 1');
  });
});
