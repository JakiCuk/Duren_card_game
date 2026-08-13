import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LOCALES, translate, type Dictionary, type Locale, type Params } from './core.js';
import { en } from './en.js';
import { sk } from './sk.js';
import { uk } from './uk.js';
import { readStored, writeStored } from '../storage.js';

export type { Locale, Params };
export { LOCALES };

export const DICTIONARIES: Record<Locale, Dictionary> = { sk, uk, en };

export const LOCALE_NAMES: Record<Locale, string> = {
  sk: 'Slovenčina',
  uk: 'Українська',
  en: 'English',
};

const STORAGE_KEY = 'locale';

const isLocale = (value: string | null): value is Locale =>
  value !== null && (LOCALES as readonly string[]).includes(value);

/** Saved choice first, then the browser's preference, then Slovak. */
export function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'sk';
  const saved = readStored(STORAGE_KEY);
  if (isLocale(saved)) return saved;
  for (const candidate of window.navigator.languages ?? []) {
    const base = candidate.split('-')[0];
    if (isLocale(base ?? null)) return base as Locale;
  }
  return 'sk';
}

export type Translate = (key: string, params?: Params) => string;

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => initial ?? detectLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    writeStored(STORAGE_KEY, next);
  }, []);

  // Screen readers and browser features (hyphenation, spellcheck) key off this.
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(DICTIONARIES[locale], locale, key, params),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (value === null) throw new Error('useI18n used outside I18nProvider');
  return value;
}

/** Shorthand for components that only need to translate. */
export const useT = (): Translate => useI18n().t;

export function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className="langSwitch">
      <span className="visually-hidden">{t('field.language')}</span>
      <select
        value={locale}
        aria-label={t('field.language')}
        onChange={(e) => setLocale(e.target.value as Locale)}
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {LOCALE_NAMES[code]}
          </option>
        ))}
      </select>
    </label>
  );
}
