import { describe, expect, it } from 'vitest';
import { cardCode, fullDeck, parseCardCode } from '../../src/engine/index.js';
import { defaultTheme, getTheme, listThemes, missingAssets } from '../../src/client/cards/assets.js';

describe('card themes', () => {
  it('ships at least one theme', () => {
    expect(listThemes().length).toBeGreaterThan(0);
  });

  it('resolves all 52 cards and a back for every theme', () => {
    for (const theme of listThemes()) {
      expect(missingAssets(theme), `theme ${theme.id}`).toEqual([]);
      expect(theme.back).toBeTruthy();
    }
  });

  it('maps each card to its own distinct asset', () => {
    const theme = defaultTheme();
    const urls = new Set(fullDeck(52).map((c) => theme.card(c)));
    expect(urls.size).toBe(52);
    expect(urls.has(theme.back)).toBe(false);
  });

  it('resolves a card to the same asset every time', () => {
    // Vite inlines small SVGs as data URIs in dev and emits fingerprinted files
    // in a build, so the URL shape is not something to assert on. What must
    // hold in both is that the mapping is stable and card-specific.
    const theme = defaultTheme();
    for (const code of ['AS', 'TH', '6C', '2D']) {
      const card = parseCardCode(code);
      expect(theme.card(card)).toBe(theme.card(card));
      expect(theme.card(card)).not.toBe(theme.back);
    }
    // Same rank, different suit must never collide.
    expect(theme.card(parseCardCode('AS'))).not.toBe(theme.card(parseCardCode('AH')));
  });

  it('states an aspect ratio the layout can reserve space with', () => {
    for (const theme of listThemes()) {
      expect(theme.aspect).toBeGreaterThan(0.5);
      expect(theme.aspect).toBeLessThan(1);
    }
  });

  it('fails loudly on an unknown theme rather than rendering nothing', () => {
    expect(() => getTheme('does-not-exist')).toThrow(/Unknown card theme/);
  });

  it('keeps the engine as the only source of card codes', () => {
    // If these ever disagree, every asset lookup silently breaks.
    expect(cardCode(parseCardCode('QS'))).toBe('QS');
  });
});
