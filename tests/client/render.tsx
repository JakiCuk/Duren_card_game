import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { App } from '../../src/client/App.js';
import { I18nProvider, type Locale } from '../../src/client/i18n/index.js';

/**
 * Renders the app with the language pinned.
 *
 * Without pinning, the locale would come from jsdom's `navigator.languages`
 * (en-US), and every assertion written against the Slovak UI would fail for a
 * reason that has nothing to do with what is being tested.
 */
export const renderApp = (locale: Locale = 'sk') =>
  render(
    <I18nProvider initial={locale}>
      <App />
    </I18nProvider>,
  );

export const renderWithI18n = (node: ReactElement, locale: Locale = 'sk') =>
  render(<I18nProvider initial={locale}>{node}</I18nProvider>);
