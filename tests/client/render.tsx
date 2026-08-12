import { render } from '@testing-library/react';
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

export const renderWithI18n = (node: ReactElement, locale: Locale = 'sk') =>
  render(
    <StrictMode>
      <I18nProvider initial={locale}>{node}</I18nProvider>
    </StrictMode>,
  );
