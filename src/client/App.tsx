import { useMemo, useState } from 'react';
import { BOT_CATALOGUE, type BotLevel } from '../bots/index.js';
import type { GameResult } from '../engine/index.js';
import { DEFAULT_RULES, validateConfig, type RuleConfig } from '../shared/rules.js';
import { CLIENT_VERSION } from '../shared/version.js';
import { Board } from './game/Board.js';
import { describeEvent, describePublicEvent } from './game/log.js';
import { modelFromState, modelFromView } from './game/model.js';
import { RulesPanel } from './game/RulesPanel.js';
import { defaultSetup, useLocalGame, type LocalGameSetup } from './game/useLocalGame.js';
import { Lobby } from './net/Lobby.js';
import { useOnline } from './net/useOnline.js';

type Mode = 'local' | 'online';

const localSeatName = (seat: number): string => `Hráč ${seat + 1}`;

export function App() {
  const [mode, setMode] = useState<Mode>('local');

  return (
    <main className="shell">
      <header className="masthead">
        <h1>Durak</h1>
        <nav className="modes">
          <button
            type="button"
            className={`btn${mode === 'local' ? ' btn--on' : ''}`}
            onClick={() => setMode('local')}
          >
            Na tomto zariadení
          </button>
          <button
            type="button"
            className={`btn${mode === 'online' ? ' btn--on' : ''}`}
            onClick={() => setMode('online')}
          >
            Online izba
          </button>
        </nav>
      </header>

      {mode === 'local' ? <LocalGame /> : <OnlineGame />}

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

// --- on this device ---------------------------------------------------------

function LocalGame() {
  const game = useLocalGame(defaultSetup());
  const [draft, setDraft] = useState<LocalGameSetup>(game.setup);

  const verdict = useMemo(() => validateConfig(draft.config, draft.players), [draft]);
  const model = useMemo(
    () => modelFromState(game.state, { seatName: localSeatName, isBot: game.isBot }),
    [game.state, game.isBot],
  );

  const log = useMemo(() => {
    const lines: string[] = [];
    for (const e of game.events) {
      const line = describeEvent(e, localSeatName);
      if (line !== null) lines.push(line);
    }
    return lines.slice(-12).reverse();
  }, [game.events]);

  return (
    <>
      <p className="lede">Hra proti botom alebo proti sebe na jednom zariadení.</p>

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

      {game.state.result ? <ResultBanner result={game.state.result} seatName={localSeatName} /> : null}

      <Board model={model} play={game.play} />
      <Log lines={log} />
    </>
  );
}

// --- online room ------------------------------------------------------------

function OnlineGame() {
  const net = useOnline(true);
  const [name, setName] = useState(() => net.savedName() || 'Hráč');
  const [code, setCode] = useState('');

  const seatName = (seat: number): string => {
    const occupant = net.room?.seats[seat];
    if (occupant === undefined || occupant.kind === 'empty') return `Miesto ${seat + 1}`;
    return occupant.name;
  };

  const model = useMemo(
    () =>
      net.view === null
        ? null
        : modelFromView(net.view, {
            seatName,
            isBot: (seat) => net.room?.seats[seat]?.kind === 'bot',
            connected: (seat) => {
              const occupant = net.room?.seats[seat];
              return occupant?.kind === 'human' ? occupant.connected : true;
            },
          }),
    // `seatName` closes over the room, so the room belongs in the deps.
    [net.view, net.room],
  );

  const log = useMemo(() => {
    const lines: string[] = [];
    for (const e of net.events) {
      const line = describePublicEvent(e, seatName);
      if (line !== null) lines.push(line);
    }
    return lines.slice(-12).reverse();
  }, [net.events, net.room]);

  const inGame = net.room !== null && net.room.phase === 'playing' && model !== null;

  return (
    <>
      <p className="lede">
        Hra so živými hráčmi. Vytvor izbu a pošli kód — netreba účet ani inštaláciu.{' '}
        <ConnectionBadge state={net.connection} />
      </p>

      {net.error !== null ? (
        <p className="problem problem--error" role="alert" onClick={net.clearError}>
          {explainError(net.error)}
        </p>
      ) : null}

      {net.room === null ? (
        <section className="panel">
          <div className="panel__row">
            <label>
              Tvoje meno
              <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn btn--primary"
              disabled={net.connection !== 'online' || name.trim().length === 0}
              onClick={() => net.createRoom(name.trim(), DEFAULT_RULES)}
            >
              Vytvoriť izbu
            </button>
          </div>
          <div className="panel__row">
            <label>
              Kód izby
              <input
                value={code}
                maxLength={5}
                placeholder="ABC12"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </label>
            <button
              type="button"
              className="btn"
              disabled={net.connection !== 'online' || code.trim().length !== 5}
              onClick={() => net.joinRoom(code.trim(), name.trim())}
            >
              Pripojiť sa
            </button>
          </div>
        </section>
      ) : null}

      {net.room !== null && !inGame ? (
        <Lobby
          room={net.room}
          mySeat={net.mySeat}
          playerId={net.playerId ?? ''}
          chat={net.chat}
          onConfig={net.setConfig}
          onSeat={net.takeSeat}
          onAddBot={net.addBot}
          onRemoveBot={net.removeBot}
          onStart={net.room.phase === 'finished' ? net.rematch : net.start}
          onLeave={net.leaveRoom}
          onChat={net.sendChat}
        />
      ) : null}

      {inGame && model !== null ? (
        <>
          {model.result ? <ResultBanner result={model.result} seatName={seatName} /> : null}
          <Board
            model={model}
            play={(move) => {
              if (net.view) net.move(net.view.seq, move);
            }}
          />
          <Log lines={log} />
        </>
      ) : null}
    </>
  );
}

function ConnectionBadge({ state }: { state: 'connecting' | 'online' | 'offline' }) {
  const label = state === 'online' ? 'pripojené' : state === 'connecting' ? 'pripájam sa…' : 'odpojené';
  return <span className={`badge badge--${state}`}>{label}</span>;
}

// --- shared bits ------------------------------------------------------------

function ResultBanner({ result, seatName }: { result: GameResult; seatName: (seat: number) => string }) {
  const text =
    result.reason === 'stalemate'
      ? 'Patová pozícia — karty len kolovali dokola, nikto nie je durak.'
      : result.durak === null
        ? 'Remíza — všetci sa zbavili kariet naraz.'
        : // Player ids are seat-derived ("p0" locally, "s0" on the server).
          `Durak je ${seatName(Number(result.durak.replace(/^\D+/, '')))}.`;
  return <section className={`banner${result.durak === null ? '' : ' banner--loss'}`}>{text}</section>;
}

function Log({ lines }: { lines: string[] }) {
  return (
    <section className="log">
      <h2>Priebeh</h2>
      <ol>
        {lines.map((line, i) => (
          <li key={`${i}-${line}`}>{line}</li>
        ))}
      </ol>
    </section>
  );
}

function describeBots(bots: readonly (BotLevel | null)[]): string {
  const levels = bots.filter((b): b is BotLevel => b !== null);
  if (levels.length === 0) return 'Všetky miesta hrajú ľudia na jednom zariadení.';
  return [...new Set(levels)]
    .map((l) => BOT_CATALOGUE.find((b) => b.level === l))
    .filter((b) => b !== undefined)
    .map((b) => `${b.name} — ${b.blurb}`)
    .join(' ');
}

function explainError(code: string): string {
  switch (code) {
    case 'room_not_found':
      return 'Izba s týmto kódom neexistuje. Skontroluj kód.';
    case 'room_full':
      return 'Izba je plná.';
    case 'room_in_progress':
      return 'V izbe už beží hra.';
    case 'not_host':
      return 'Toto môže zmeniť len hostiteľ.';
    case 'not_enough_players':
      return 'Na hru treba aspoň dvoch hráčov.';
    case 'server_full':
      return 'Server je momentálne plný, skús to o chvíľu.';
    case 'seat_taken':
      return 'Toto miesto je už obsadené.';
    case 'rate_limited':
      return 'Priveľa akcií naraz, spomaľ trochu.';
    case 'illegal_move':
      return 'Tento ťah nie je podľa pravidiel.';
    case 'protocol_mismatch':
      return 'Stránka je zastaraná — obnov ju (Ctrl+R).';
    default:
      return `Chyba: ${code}`;
  }
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
