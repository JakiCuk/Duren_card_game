import { useCallback, useEffect, useState } from 'react';

/** The three looks the design ships. Cards are the same SVGs in all of them. */
export const SKINS = ['organic', 'modern', 'classic'] as const;
export type Skin = (typeof SKINS)[number];

export type Theme = 'light' | 'dark';

export interface Settings {
  /** Pause a bot takes before playing, in milliseconds. */
  botDelayMs: number;
  /**
   * Freeze the bots whenever we have a card we could throw in.
   *
   * Without it a second bot can pile on while you are still reading the table,
   * and the chance to add your own card is gone before you noticed you had one.
   */
  holdForThrowIn: boolean;
  /** Show the running transcript of played cards. */
  showLog: boolean;
  /** Show the trump / bout / deck / discard row above the pile. */
  showStatus: boolean;
  /** Which set of design tokens the page runs on. */
  skin: Skin;
  /** Day or night. Not derived from the OS: the switch is in the header. */
  theme: Theme;
}

export const DEFAULT_SETTINGS: Settings = {
  botDelayMs: 900,
  holdForThrowIn: true,
  showLog: true,
  showStatus: true,
  skin: 'organic',
  theme: 'light',
};

export const BOT_DELAY_RANGE = { min: 0, max: 4000, step: 100 } as const;

const KEY = 'durak.settings';

const isSkin = (value: unknown): value is Skin =>
  typeof value === 'string' && (SKINS as readonly string[]).includes(value);

function load(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      botDelayMs:
        typeof parsed.botDelayMs === 'number'
          ? Math.min(Math.max(parsed.botDelayMs, BOT_DELAY_RANGE.min), BOT_DELAY_RANGE.max)
          : DEFAULT_SETTINGS.botDelayMs,
      holdForThrowIn: parsed.holdForThrowIn ?? DEFAULT_SETTINGS.holdForThrowIn,
      showLog: parsed.showLog ?? DEFAULT_SETTINGS.showLog,
      showStatus: parsed.showStatus ?? DEFAULT_SETTINGS.showStatus,
      skin: isSkin(parsed.skin) ? parsed.skin : DEFAULT_SETTINGS.skin,
      theme: parsed.theme === 'dark' ? 'dark' : DEFAULT_SETTINGS.theme,
    };
  } catch {
    // A corrupted entry is not worth a broken page.
    return DEFAULT_SETTINGS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load);

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(KEY, JSON.stringify(settings));
  }, [settings]);

  // The browser chrome (scrollbars, form controls, the address bar on mobile)
  // takes its cue from here, not from the app's own colours.
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.style.colorScheme = settings.theme;
  }, [settings.theme]);

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
  }, []);

  return { settings, set };
}
