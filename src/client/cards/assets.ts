import { cardCode, fullDeck, type CardId } from '../../engine/index.js';

/**
 * The single seam between the game and its artwork.
 *
 * Nothing else in the client may name a file, an SVG or a suit glyph. Swapping
 * in a different deck is therefore copying 53 files into a folder and adding
 * one entry below — never a code change in the game itself.
 */
export type ThemeId = string;

export interface CardTheme {
  id: ThemeId;
  /** Human-readable name; becomes a translation key once i18n lands. */
  name: string;
  /** width / height, used to reserve layout space before the image loads. */
  aspect: number;
  back: string;
  card(c: CardId): string;
}

/**
 * Bundled decks live under `src` rather than `public` on purpose: Vite then
 * resolves and fingerprints them at build time, so a missing or misnamed file
 * fails the build instead of showing a broken image mid-game. Artwork dropped
 * onto the server at runtime is a separate, later mechanism.
 */
const files = import.meta.glob<string>('./decks/*/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
});

function collect(themeId: ThemeId): Record<string, string> {
  const prefix = `./decks/${themeId}/`;
  const out: Record<string, string> = {};
  for (const [path, url] of Object.entries(files)) {
    if (!path.startsWith(prefix)) continue;
    const name = path.slice(prefix.length).replace(/\.svg$/, '');
    out[name] = url;
  }
  return out;
}

function buildTheme(id: ThemeId, name: string, aspect: number): CardTheme {
  const assets = collect(id);
  const back = assets['back'];
  if (back === undefined) throw new Error(`Card theme "${id}" has no back.svg`);

  return {
    id,
    name,
    aspect,
    back,
    card(c: CardId): string {
      const url = assets[cardCode(c)];
      if (url === undefined) throw new Error(`Card theme "${id}" is missing ${cardCode(c)}.svg`);
      return url;
    },
  };
}

const THEMES: CardTheme[] = [buildTheme('classic', 'Klasické', 234 / 333)];

export const listThemes = (): CardTheme[] => [...THEMES];

export function getTheme(id: ThemeId): CardTheme {
  const theme = THEMES.find((t) => t.id === id);
  if (!theme) throw new Error(`Unknown card theme "${id}"`);
  return theme;
}

export const defaultTheme = (): CardTheme => THEMES[0]!;

/** Used by the asset test: every theme must resolve all 52 cards and its back. */
export function missingAssets(theme: CardTheme): string[] {
  const missing: string[] = [];
  for (const card of fullDeck(52)) {
    try {
      theme.card(card);
    } catch {
      missing.push(cardCode(card));
    }
  }
  if (!theme.back) missing.push('back');
  return missing;
}
