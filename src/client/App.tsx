import { useMemo, useState } from 'react';
import { validateConfig, type RuleConfig } from '../shared/rules.js';
import { CLIENT_VERSION } from '../shared/version.js';
import { Board } from './game/Board.js';
import { describeEvent } from './game/log.js';
import { defaultSetup, useLocalGame, type LocalGameSetup } from './game/useLocalGame.js';

const seatName = (seat: number): string => `Hráč ${seat + 1}`;

export function App() {
  const game = useLocalGame(defaultSetup());
  const [draft, setDraft] = useState<LocalGameSetup>(game.setup);

  const verdict = useMemo(() => validateConfig(draft.config, draft.players), [draft]);
  const result = game.state.result;

  const log = useMemo(() => {
    const lines: string[] = [];
    for (const e of game.events) {
      const line = describeEvent(e, seatName);
      if (line !== null) lines.push(line);
    }
    return lines.slice(-12).reverse();
  }, [game.events]);

  return (
    <main className="shell">
      <header className="masthead">
        <h1>Durak</h1>
        <p className="lede">Hra na jednom zariadení. Boti a online hra pribudnú v ďalších krokoch.</p>
      </header>

      <section className="panel">
        <div className="panel__row">
          <label>
            Hráčov
            <select
              value={draft.players}
              onChange={(e) => setDraft({ ...draft, players: Number(e.target.value) })}
            >
              {[2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <label>
            Balík
            <select
              value={draft.config.deckSize}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  config: { ...draft.config, deckSize: Number(e.target.value) as RuleConfig['deckSize'] },
                })
              }
            >
              <option value={36}>36 kariet</option>
              <option value={52}>52 kariet</option>
            </select>
          </label>

          <label>
            Seed
            <input
              value={draft.seed}
              onChange={(e) => setDraft({ ...draft, seed: e.target.value })}
              size={10}
              title="Rovnaký seed rozdá rovnaké karty — hra je plne reprodukovateľná."
            />
          </label>

          <button
            type="button"
            className="btn btn--primary"
            disabled={verdict.errors.length > 0}
            onClick={() => game.restart(draft)}
          >
            Nová hra
          </button>
          <button type="button" className="btn" onClick={game.undo} disabled={!game.canUndo}>
            Späť
          </button>
        </div>

        {verdict.errors.length > 0 ? (
          <p className="problem problem--error">{verdict.errors.map(explain).join(' ')}</p>
        ) : null}
        {verdict.warnings.length > 0 ? (
          <p className="problem problem--warn">{verdict.warnings.map(explain).join(' ')}</p>
        ) : null}
      </section>

      {result ? (
        <section className={`banner${result.durak === null ? '' : ' banner--loss'}`}>
          {result.durak === null
            ? 'Remíza — všetci sa zbavili kariet naraz.'
            : `Durak je ${seatName(Number(result.durak.slice(1)))}.`}
        </section>
      ) : null}

      <Board
        state={game.state}
        actors={game.actors}
        movesFor={game.movesFor}
        play={game.play}
        seatName={seatName}
      />

      <section className="log">
        <h2>Priebeh</h2>
        <ol>
          {log.map((line, i) => (
            <li key={`${i}-${line}`}>{line}</li>
          ))}
        </ol>
      </section>

      <footer className="footer">
        <span>v{CLIENT_VERSION}</span>
        <span>
          Karty: SVG Playing Cards od Daniela S. Fowlera (
          <a href="https://tekeye.uk" rel="noreferrer noopener" target="_blank">
            tekeye.uk
          </a>
          ), CC0 / public domain.
        </span>
      </footer>
    </main>
  );
}

function explain(problem: { code: string; params?: Record<string, number | string> }): string {
  const p = problem.params ?? {};
  switch (problem.code) {
    case 'deck_too_small':
      return `${String(p['deckSize'])} kariet nestačí pre ${String(p['players'])} hráčov — treba aspoň ${String(p['needed'])}, aby zostala tromfová karta.`;
    case 'deck_barely_sufficient':
      return 'Po rozdaní zostane v balíku veľmi málo kariet, koncovka príde takmer hneď.';
    case 'players_out_of_range':
      return `Počet hráčov musí byť ${String(p['min'])} až ${String(p['max'])}.`;
    case 'hand_size_out_of_range':
      return 'Nepodporovaná veľkosť ruky.';
    case 'max_table_slots_out_of_range':
      return 'Nepodporovaný limit kariet na stole.';
    case 'first_bout_cap_meaningless':
      return 'Obmedzenie prvého kola nedáva pri takto malej ruke zmysel.';
    default:
      return problem.code;
  }
}

export default App;
