import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { defaultTheme, getTheme, type CardTheme, type ThemeId } from './assets.js';

const CardThemeContext = createContext<CardTheme | null>(null);

/**
 * Which deck the cards are drawn from.
 *
 * A context rather than a prop threaded through the board: the choice is a
 * viewing preference, not game state, and every card in the tree wants the same
 * answer. Passing it down by hand would put an artwork parameter on components
 * whose whole point is that they know nothing about artwork.
 */
export function CardThemeProvider({ id, children }: { id: ThemeId; children: ReactNode }) {
  const theme = useMemo(() => {
    try {
      return getTheme(id);
    } catch {
      // A stale id in localStorage must not blank the table.
      return defaultTheme();
    }
  }, [id]);
  return <CardThemeContext.Provider value={theme}>{children}</CardThemeContext.Provider>;
}

export const useCardTheme = (): CardTheme => useContext(CardThemeContext) ?? defaultTheme();
