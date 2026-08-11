import { useMemo, useState } from 'react';
import { BOT_CATALOGUE, type BotLevel } from '../bots/index.js';
import { validateConfig, type RuleConfig } from '../shared/rules.js';
import { CLIENT_VERSION } from '../shared/version.js';
import { Board } from './game/Board.js';
import { RulesPanel } from './game/RulesPanel.js';
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
        <p className="lede">
          Hra proti botom alebo proti sebe na jednom zariadení. Online hra so živými hráčmi
          pribudne v ďalšom kroku.
        </p>
      </header>

      <section className="panel">
        <div className="panel__row">
          <label>
            Hráčov
            <select
              value={draft.players}
              onChange={(e) => {
                const players = Number(e.target.value);
                const bots = Array.from({ length: players }, (_, i) => draft.bots[i] ?? (i === 0 ? null : 2));
                setDraft({ ...draft, players, bots });
              }}
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

        <div className="panel__row panel__row--seats">
          {Array.from({ length: draft.players }, (_, seat) => (
            <label key={seat}>
              {`Miesto ${seat + 1}`}
              <select
                value={draft.bots[seat] ?? 'human'}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    bots: draft.bots.map((b, i) =>
                      i === seat ? (e.target.value === 'human' ? null : (Number(e.target.value) as BotLevel)) : b,
                    ),
                  })
                }
              >
                <option value="human">Človek</option>
                {BOT_CATALOGUE.map((bot) => (
                  <option key={bot.level} value={bot.level} disabled={!bot.available}>
                    {bot.name}
                    {bot.available ? '' : ' (čoskoro)'}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <p className="hint">{describeBots(draft.bots.slice(0, draft.players))}</p>

        <RulesPanel config={draft.config} onChange={(config) => setDraft({ ...draft, config })} />

        {verdict.errors.length > 0 ? (
          <p className="problem problem--error">{verdict.errors.map(explain).join(' ')}</p>
        ) : null}
        {verdict.warnings.length > 0 ? (
          <p className="problem problem--warn">{verdict.warnings.map(explain).join(' ')}</p>
        ) : null}
      </section>

      {result ? (
        <section className={`banner${result.durak === null ? '' : ' banner--loss'}`}>
          {result.reason === 'stalemate'
            ? 'Patová pozícia — karty len kolovali dokola, nikto nie je durak.'
            : result.durak === null
              ? 'Remíza — všetci sa zbavili kariet naraz.'
              : `Durak je ${seatName(Number(result.durak.slice(1)))}.`}
        </section>
      ) : null}

      <Board
        state={game.state}
        actors={game.actors}
        humanActors={game.humanActors}
        isBot={game.isBot}
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

function describeBots(bots: readonly (BotLevel | null)[]): string {
  const levels = bots.filter((b): b is BotLevel => b !== null);
  if (levels.length === 0) return 'Všetky miesta hrajú ľudia na jednom zariadení.';
  const names = [...new Set(levels)]
    .map((l) => BOT_CATALOGUE.find((b) => b.level === l))
    .filter((b) => b !== undefined)
    .map((b) => `${b.name} — ${b.blurb}`);
  return names.join(' ');
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
    case 'attack_cap_out_of_range':
      return 'Nepodporovaný limit útoku.';
    case 'scope_has_no_effect':
      return 'Pri tomto počte hráčov je obrancov sused každý — voľba nič nemení.';
    case 'transfer_options_without_transfer':
      return 'Podvoľby prehadzovania nič nerobia, kým je samotné prehadzovanie vypnuté.';
    case 'transfer_two_players':
      return 'Vo dvojici sa útok prehodením vracia späť na útočníka — hra je tým divokejšia.';
    case 'must_beat_all_changes_the_game':
      return 'Pravidlo „musí zbiť" berie obrancovi voľbu a výrazne pomáha počítajúcim botom.';
    case 'must_beat_all_with_unlimited_pile':
      return 'S neobmedzeným prihadzovaním po „beriem" môžu útočníci obrancu mlieť celú ruku.';
    default:
      return problem.code;
  }
}

export default App;
