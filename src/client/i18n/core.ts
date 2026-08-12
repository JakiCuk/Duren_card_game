import { LOCALES, type Locale } from '../../shared/protocol.js';

export type { Locale };
export { LOCALES };

/**
 * A message is either a plain string or one form per plural category.
 *
 * Categories come from `Intl.PluralRules`, which knows that Slovak needs
 * one/few/other and Ukrainian one/few/many/other. Hard-coding those rules — or
 * pulling in a library to do it — would be work the platform already did.
 */
export type Message = string | Partial<Record<Intl.LDMLPluralRule, string>>;
export type Dictionary = Record<string, Message>;

export type Params = Record<string, string | number>;

const pluralRules = new Map<Locale, Intl.PluralRules>();

function categoryFor(locale: Locale, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

/**
 * Looks a key up and fills in `{placeholders}`.
 *
 * A missing key returns the key itself rather than an empty space: a visible
 * `lobby.share` in the UI is a bug report, whereas a blank is a mystery.
 */
export function translate(dict: Dictionary, locale: Locale, key: string, params: Params = {}): string {
  const message = dict[key];
  if (message === undefined) return key;

  let text: string;
  if (typeof message === 'string') {
    text = message;
  } else {
    const count = typeof params['count'] === 'number' ? params['count'] : 0;
    text = message[categoryFor(locale, count)] ?? message.other ?? key;
  }

  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** Every plural category `Intl` can produce for this locale's integers. */
export function integerCategories(locale: Locale): Set<Intl.LDMLPluralRule> {
  const rules = new Intl.PluralRules(locale);
  const seen = new Set<Intl.LDMLPluralRule>();
  for (let n = 0; n <= 120; n++) seen.add(rules.select(n));
  return seen;
}
