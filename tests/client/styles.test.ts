import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  fileURLToPath(new URL('../../src/client/styles.css', import.meta.url)),
  'utf8',
);

/**
 * The stylesheet carries the whole layout, and every other test in this folder
 * runs in jsdom, which applies none of it. A rule can therefore disappear —
 * during an edit, a merge, a careless replace — and leave 300 green tests
 * beside a page where the table has no table on it.
 *
 * This is not a design review. It is the list of selectors without which the
 * board stops being a board: absolute positioning, the felt, the pile, the
 * chairs, the tray.
 */
const LOAD_BEARING = [
  '.app {',
  '.stage {',
  '.board {',
  '.felt {',
  '.felt__centre {',
  '.felt__pile {',
  '.felt__deck {',
  '.deck__pile {',
  '.deck__count {',
  '.table {',
  '.pair {',
  '.pair__defence {',
  '.tray {',
  '.actions {',
  '.seat--across {',
  '.seat--me {',
  '.seat__head {',
  '.seat__who {',
  '.seat__count {',
  '.seat__trump {',
  '.avatar {',
  '.hand--fan {',
  '.card__img {',
  '.topbar {',
  '.menu {',
  '.menu__scrim {',
  '.log {',
  '.banner {',
];

describe('the stylesheet', () => {
  it.each(LOAD_BEARING)('still defines %s', (selector) => {
    expect(css).toContain(selector);
  });

  it('positions the chairs and the tray absolutely, or they stack in a column', () => {
    for (const rule of ['.seat--across {', '.tray {', '.felt {', '.felt__centre {']) {
      const block = css.slice(css.indexOf(rule), css.indexOf('}', css.indexOf(rule)));
      expect(block, rule).toContain('position: absolute');
    }
  });

  it('keeps one animation per way a card can leave the table', () => {
    // Sweeping a beaten bout, scooping up a taken one and dealing from the deck
    // look nothing alike, and collapsing them was what made taking read as
    // discarding.
    for (const mode of ['cardBito', 'cardTake', 'cardDeal', 'cardIn', 'cardFlip']) {
      expect(css, mode).toContain(`@keyframes ${mode}`);
    }
  });

  it('defines every skin and theme the settings offer', () => {
    // Organic is the base `.app` block rather than an attribute selector: it is
    // the default, and giving the default its own override would mean the page
    // has no tokens at all until the attribute is set.
    for (const skin of ['modern', 'classic']) {
      expect(css).toContain(`.app[data-skin='${skin}']`);
      expect(css).toContain(`.app[data-skin='${skin}'][data-theme='dark']`);
    }
    expect(css).toContain(".app[data-theme='dark']");
    expect(css).toContain('--color-accent-2-900');
  });
});
