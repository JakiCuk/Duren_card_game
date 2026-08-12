import { describe, expect, it } from 'vitest';
import { boutWaitsOnlyOn } from '../../src/client/game/useLocalGame.js';
import { makeState } from '../engine/helpers.js';

const humanIsSeat0 = (seat: number): boolean => seat !== 0;

describe('when the game should stop and ask about throwing in', () => {
  it('says nothing while the defender still has to answer', () => {
    // Seat 0 attacked and could add another six, but seat 1 has not responded.
    // Asking here is what made the old build demand a confirmation after every
    // single card.
    const s = makeState({
      hands: ['6D 9H', '7C KH'],
      trump: 'S',
      table: [['6C', null]],
      attacker: 0,
      defender: 1,
      defenderHandAtBoutStart: 2,
    });
    expect(boutWaitsOnlyOn(s, humanIsSeat0)).toBeNull();
  });

  it('asks once the attack has been beaten and only we could add more', () => {
    const s = makeState({
      hands: ['7D 9H', 'KH'],
      trump: 'S',
      table: [['6C', '7C']],
      attacker: 0,
      defender: 1,
      defenderHandAtBoutStart: 2,
    });
    expect(boutWaitsOnlyOn(s, humanIsSeat0)).toBe(0);
  });

  it('asks when the defender has taken and we could still pile on', () => {
    const s = makeState({
      hands: ['6D 9H', 'KH AC'],
      trump: 'S',
      table: [['6C', null]],
      attacker: 0,
      defender: 1,
      defenderTaking: true,
      defenderHandAtBoutStart: 2,
    });
    expect(boutWaitsOnlyOn(s, humanIsSeat0)).toBe(0);
  });

  it('waits for the other attackers before it waits for us', () => {
    // Seat 2 is a bot that has not passed yet, so the bout is not ours to close.
    const s = makeState({
      hands: ['7D 9H', 'KH', '7H 2C'],
      trump: 'S',
      table: [['6C', '7C']],
      attacker: 0,
      defender: 1,
      defenderHandAtBoutStart: 2,
      config: { deckSize: 52 },
    });
    expect(boutWaitsOnlyOn(s, humanIsSeat0)).toBeNull();
  });

  it('says nothing when we have no card of a rank on the table', () => {
    const s = makeState({
      hands: ['9H QD', 'KH'],
      trump: 'S',
      table: [['6C', '7C']],
      attacker: 0,
      defender: 1,
      defenderHandAtBoutStart: 2,
    });
    expect(boutWaitsOnlyOn(s, humanIsSeat0)).toBeNull();
  });

  it('says nothing before anything has been played', () => {
    const s = makeState({ hands: ['6C 7C', 'KH'], trump: 'S', attacker: 0, defender: 1 });
    expect(boutWaitsOnlyOn(s, humanIsSeat0)).toBeNull();
  });
});
