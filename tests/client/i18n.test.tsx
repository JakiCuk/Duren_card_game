// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { integerCategories, translate, type Locale } from '../../src/client/i18n/core.js';
import { DICTIONARIES, LOCALES } from '../../src/client/i18n/index.js';
import { sk } from '../../src/client/i18n/sk.js';
import { openMenu, renderApp } from './render.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const placeholders = (message: unknown): Set<string> => {
  const found = new Set<string>();
  const scan = (text: string): void => {
    for (const [, name] of text.matchAll(/\{(\w+)\}/g)) found.add(name!);
  };
  if (typeof message === 'string') scan(message);
  else if (message !== null && typeof message === 'object') {
    for (const form of Object.values(message as Record<string, string>)) scan(form);
  }
  return found;
};

describe('dictionaries', () => {
  const reference = Object.keys(sk).sort();

  for (const locale of LOCALES) {
    it(`${locale} has exactly the same keys as Slovak`, () => {
      const keys = Object.keys(DICTIONARIES[locale]).sort();
      const missing = reference.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !reference.includes(k));
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    });

    it(`${locale} uses the same placeholders as Slovak in every message`, () => {
      // A translation that drops {name} silently produces a sentence about
      // nobody, which no type checker would ever catch.
      for (const key of reference) {
        expect(placeholders(DICTIONARIES[locale][key]), `${locale} / ${key}`).toEqual(
          placeholders(sk[key]),
        );
      }
    });

    it(`${locale} covers every plural category the language actually uses`, () => {
      const needed = integerCategories(locale);
      for (const [key, message] of Object.entries(DICTIONARIES[locale])) {
        if (typeof message === 'string') continue;
        for (const category of needed) {
          expect(message[category], `${locale} / ${key} / ${category}`).toBeTypeOf('string');
        }
      }
    });
  }

  it('expects the categories that make these three languages awkward', () => {
    // Not an implementation detail: this is why a naive "n === 1" plural is
    // wrong here, and why the dictionaries carry several forms.
    expect(integerCategories('sk')).toEqual(new Set(['one', 'few', 'other']));
    expect(integerCategories('uk')).toEqual(new Set(['one', 'few', 'many']));
    expect(integerCategories('en')).toEqual(new Set(['one', 'other']));
  });
});

describe('translate', () => {
  const dict = { greet: 'Ahoj {name}', cards: { one: '{count} karta', few: '{count} karty', other: '{count} kariet' } };

  it('fills placeholders', () => {
    expect(translate(dict, 'sk', 'greet', { name: 'Roman' })).toBe('Ahoj Roman');
  });

  it('picks the Slovak forms by count', () => {
    expect(translate(dict, 'sk', 'cards', { count: 1 })).toBe('1 karta');
    expect(translate(dict, 'sk', 'cards', { count: 3 })).toBe('3 karty');
    expect(translate(dict, 'sk', 'cards', { count: 7 })).toBe('7 kariet');
  });

  it('returns the key for a missing message rather than an empty string', () => {
    // A visible `some.key` in the UI is a bug report; a blank is a mystery.
    expect(translate(dict, 'sk', 'nope')).toBe('nope');
  });

  it('leaves an unknown placeholder alone instead of printing undefined', () => {
    expect(translate(dict, 'sk', 'greet', {})).toBe('Ahoj {name}');
  });
});

describe('the app in three languages', () => {
  const localeOf = (l: Locale) => l;

  it('starts in the language it is given', () => {
    renderApp(localeOf('uk'));
    expect(screen.getByRole('heading', { name: 'Дурень' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'На цьому пристрої' })).toBeTruthy();
  });

  it('switches language without losing the game', async () => {
    const user = userEvent.setup();
    renderApp('sk');
    await openMenu(user, /^Nastavenia a nová hra/);
    expect(screen.getByRole('button', { name: 'Nová hra' })).toBeTruthy();

    // Two humans, so nothing plays itself while the assertion runs — with a bot
    // at the table the card count changes on its own and the comparison below
    // would be measuring the bot, not the language switch.
    await user.selectOptions(screen.getByLabelText('Miesto 2'), 'human');
    await user.click(screen.getByRole('button', { name: 'Nová hra' }));
    const cardsBefore = document.querySelectorAll('.seat .hand .card img').length;

    await user.selectOptions(screen.getByLabelText('Jazyk'), 'en');

    expect(screen.getByRole('button', { name: 'New game' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Duren' })).toBeTruthy();
    // The board is still the same board, not a fresh deal.
    expect(document.querySelectorAll('.seat .hand .card img').length).toBe(cardsBefore);
  });

  it('remembers the choice for next time', async () => {
    const user = userEvent.setup();
    renderApp('sk');
    await user.selectOptions(screen.getByLabelText('Jazyk'), 'uk');
    expect(localStorage.getItem('duren.locale')).toBe('uk');
  });

  it('tells the browser which language the page is in', async () => {
    const user = userEvent.setup();
    renderApp('sk');
    expect(document.documentElement.lang).toBe('sk');
    await user.selectOptions(screen.getByLabelText('Jazyk'), 'en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('counts cards correctly in each language', () => {
    // Six cards: Slovak "kariet", Ukrainian "карт", English "cards".
    renderApp('sk');
    expect(screen.getAllByText('6 kariet').length).toBeGreaterThan(0);
    cleanup();

    renderApp('uk');
    expect(screen.getAllByText('6 карт').length).toBeGreaterThan(0);
    cleanup();

    renderApp('en');
    expect(screen.getAllByText('6 cards').length).toBeGreaterThan(0);
  });

  it('leaves no Slovak behind when running in English', () => {
    renderApp('en');
    const text = document.body.textContent ?? '';
    for (const word of ['Hráč', 'Balík', 'kariet', 'Nová hra', 'Tromf']) {
      expect(text, `"${word}" leaked into the English UI`).not.toContain(word);
    }
  });
});
