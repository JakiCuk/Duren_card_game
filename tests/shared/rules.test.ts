import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, isPlayable, validateConfig, type RuleConfig } from '../../src/shared/rules.js';

const cfg = (over: Partial<RuleConfig> = {}): RuleConfig => ({ ...DEFAULT_RULES, ...over });
const errorCodes = (config: RuleConfig, players: number): string[] =>
  validateConfig(config, players).errors.map((e) => e.code);
const warningCodes = (config: RuleConfig, players: number): string[] =>
  validateConfig(config, players).warnings.map((e) => e.code);

describe('validateConfig', () => {
  it('accepts the defaults for every supported table size', () => {
    for (const players of [2, 3, 4, 5]) expect(errorCodes(cfg(), players)).toEqual([]);
  });

  it('rejects a 36-card deck with six players', () => {
    // 6 x 6 = 36 leaves nothing to turn up as the trump card, so this is not a
    // taste question — the game cannot be dealt.
    expect(errorCodes(cfg(), 6)).toContain('deck_too_small');
    expect(errorCodes(cfg({ deckSize: 52 }), 6)).toEqual([]);
  });

  it('reports the numbers the UI needs to explain the refusal', () => {
    const problem = validateConfig(cfg(), 6).errors.find((e) => e.code === 'deck_too_small');
    expect(problem?.params).toMatchObject({ deckSize: 36, players: 6, handSize: 6, needed: 37 });
  });

  it('rejects impossible player counts', () => {
    expect(errorCodes(cfg(), 1)).toContain('players_out_of_range');
    expect(errorCodes(cfg({ deckSize: 52 }), 7)).toContain('players_out_of_range');
  });

  it('rejects hand and table sizes outside sane bounds', () => {
    expect(errorCodes(cfg({ handSize: 1 }), 2)).toContain('hand_size_out_of_range');
    expect(errorCodes(cfg({ handSize: 9 }), 2)).toContain('hand_size_out_of_range');
    expect(errorCodes(cfg({ maxTableSlots: 0 }), 2)).toContain('max_table_slots_out_of_range');
    expect(errorCodes(cfg({ maxTableSlots: 13 }), 2)).toContain('max_table_slots_out_of_range');
  });

  it('warns rather than refuses when the deal barely fits', () => {
    // 5 x 6 = 30 of 36: playable, but the endgame starts almost at once.
    expect(errorCodes(cfg(), 5)).toEqual([]);
    expect(warningCodes(cfg(), 5)).toContain('deck_barely_sufficient');
    expect(warningCodes(cfg(), 2)).not.toContain('deck_barely_sufficient');
  });

  it('warns that the first-bout cap says nothing about tiny hands', () => {
    expect(warningCodes(cfg({ firstBoutCapFive: true, handSize: 2 }), 2)).toContain(
      'first_bout_cap_meaningless',
    );
  });

  it('agrees with isPlayable', () => {
    expect(isPlayable(cfg(), 6)).toBe(false);
    expect(isPlayable(cfg({ deckSize: 52 }), 6)).toBe(true);
  });
});
