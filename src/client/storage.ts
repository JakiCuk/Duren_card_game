/**
 * Everything the browser remembers, under one name.
 *
 * The game was called Durak before it was called Duren, and the keys were named
 * after it. Renaming them outright would quietly reset everybody's language,
 * theme, deck and bot pause, and drop the token that holds their seat in a live
 * room — all for a namespace nobody ever sees. So a value written under the old
 * name is read once and copied across, and the old key is left alone: a browser
 * that still has a tab open on an older build keeps working.
 */
const PREFIX = 'duren.';
const LEGACY_PREFIX = 'durak.';

export function readStored(name: string): string | null {
  if (typeof window === 'undefined') return null;
  const current = window.localStorage.getItem(PREFIX + name);
  if (current !== null) return current;

  const legacy = window.localStorage.getItem(LEGACY_PREFIX + name);
  if (legacy !== null) window.localStorage.setItem(PREFIX + name, legacy);
  return legacy;
}

export function writeStored(name: string, value: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PREFIX + name, value);
}
