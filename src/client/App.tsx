import { CLIENT_VERSION } from '../shared/version.js';

export function App() {
  return (
    <main className="shell">
      <h1>Durak</h1>
      <p className="lede">
        Kartová hra proti botom aj proti živým hráčom. Kostra beží — herné jadro pribudne
        v ďalšom kroku.
      </p>
      <p className="version">v{CLIENT_VERSION}</p>
    </main>
  );
}
