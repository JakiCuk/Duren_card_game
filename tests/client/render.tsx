import { render, screen } from '@testing-library/react';
import type { userEvent } from '@testing-library/user-event';
import { StrictMode, type ReactElement } from 'react';
import { App } from '../../src/client/App.js';
import { I18nProvider, type Locale } from '../../src/client/i18n/index.js';

/**
 * Renders the app exactly as `main.tsx` does: inside StrictMode, with the
 * language pinned.
 *
 * StrictMode matters. It mounts every effect twice in development, and the
 * socket setup was quietly broken by that for a while — the tests passed
 * because they rendered without it and the browser did not. Pinning the locale
 * matters too: jsdom reports `en-US`, so every assertion written against the
 * Slovak UI would otherwise fail for a reason unrelated to what is tested.
 */
export const renderApp = (locale: Locale = 'sk') =>
  render(
    <StrictMode>
      <I18nProvider initial={locale}>
        <App />
      </I18nProvider>
    </StrictMode>,
  );

export const renderWithI18n = (node: ReactElement, locale: Locale = 'sk') => {
  const wrap = (child: ReactElement) => (
    <StrictMode>
      <I18nProvider initial={locale}>{child}</I18nProvider>
    </StrictMode>
  );
  const result = render(wrap(node));
  // Testing Library's own `rerender` replaces the whole tree, provider and all,
  // so anything rendered through it would land outside the context. Re-wrap.
  return { ...result, rerender: (next: ReactElement) => result.rerender(wrap(next)) };
};

/**
 * Opens one of the header pop-overs and hands back its panel.
 *
 * Settings, rules and chat all live behind a button now — the table gets the
 * window and the knobs float over it — so a test that wants a control has to
 * ask for the drawer first, exactly as a player does.
 */
export const openMenu = async (
  user: ReturnType<typeof userEvent.setup>,
  label: string | RegExp,
): Promise<HTMLElement> => {
  const button = screen.getByRole('button', { name: label });
  if (button.getAttribute('aria-expanded') !== 'true') await user.click(button);
  const panel = document.querySelector<HTMLElement>('.menu');
  if (panel === null) throw new Error(`menu ${String(label)} did not open`);
  return panel;
};
