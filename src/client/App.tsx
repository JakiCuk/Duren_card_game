import { useMemo, useState } from 'react';
import { BOT_CATALOGUE, type BotLevel } from '../bots/index.js';
import type { GameResult } from '../engine/index.js';
import { DEFAULT_RULES, validateConfig, type ConfigProblem, type RuleConfig } from '../shared/rules.js';
import { CLIENT_VERSION } from '../shared/version.js';
import { Board } from './game/Board.js';
import { describeEvent, describePublicEvent } from './game/log.js';
import { modelFromState, modelFromView } from './game/model.js';
import { RulesPanel } from './game/RulesPanel.js';
import { defaultSetup, useLocalGame, type LocalGameSetup } from './game/useLocalGame.js';
import { LanguageSwitch, useI18n, useT, type Translate } from './i18n/index.js';
import { Lobby } from './net/Lobby.js';
import { useOnline } from './net/useOnline.js';

type Mode = 'local' | 'online';

export function App() {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('local');

  return (
    <main className="shell">
      <header className="masthead">
        <h1>{t('app.title')}</h1>
        <nav className="modes">
          <button
            type="button"
            className={`btn${mode === 'local' ? ' btn--on' : ''}`}
            onClick={() => setMode('local')}
          >
            {t('mode.local')}
          </button>
          <button
            type="button"
            className={`btn${mode === 'online' ? ' btn--on' : ''}`}
            onClick={() => setMode('online')}
          >
            {t('mode.online')}
          </button>
          <LanguageSwitch />
        </nav>
      </header>

      {mode === 'local' ? <LocalGame /> : <OnlineGame />}

      <footer className="footer">
        <span>v{CLIENT_VERSION}</span>
        <span>
          <a href="https://tekeye.uk" rel="noreferrer noopener" target="_blank">
            {t('app.cardsCredit')}
          </a>
        </span>
      </footer>
    </main>
  );
}

// --- on this device ---------------------------------------------------------

function LocalGame() {
  const t = useT();
  // A player at the table, not a chair in the setup panel — different words on
  // purpose, so the two never collide in the UI.
  const localSeatName = (seat: number): string => t('player.seat', { n: seat + 1 });
  const game = useLocalGame(defaultSetup());
  const [draft, setDraft] = useState<LocalGameSetup>(game.setup);

  const verdict = useMemo(() => validateConfig(draft.config, draft.players), [draft]);
  const model = useMemo(
    // `t` is in the deps because seat names are translated: switching language
    // has to redraw the board, not just the chrome around it.
    () => modelFromState(game.state, { seatName: localSeatName, isBot: game.isBot }),
    [game.state, game.isBot, t],
  );

  const log = useMemo(() => {
    const lines: string[] = [];
    for (const e of game.events) {
      const line = describeEvent(e, t, localSeatName);
      if (line !== null) lines.push(line);
    }
    return lines.slice(-12).reverse();
  }, [game.events, t]);

  return (
    <>
      <p className="lede">{t('mode.localLede')}</p>

      <section className="panel">
        <div className="panel__row">
          <label>
            {t('field.players')}
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
            {t('field.deck')}
            <select
              value={draft.config.deckSize}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  config: { ...draft.config, deckSize: Number(e.target.value) as RuleConfig['deckSize'] },
                })
              }
            >
              <option value={36}>{t('deck.36')}</option>
              <option value={52}>{t('deck.52')}</option>
            </select>
          </label>

          <label>
            {t('field.seed')}
            <input
              value={draft.seed}
              onChange={(e) => setDraft({ ...draft, seed: e.target.value })}
              size={10}
              title={t('field.seedHint')}
            />
          </label>

          <button
            type="button"
            className="btn btn--primary"
            disabled={verdict.errors.length > 0}
            onClick={() => game.restart(draft)}
          >
            {t('action.newGame')}
          </button>
          <button type="button" className="btn" onClick={game.undo} disabled={!game.canUndo}>
            {t('action.undo')}
          </button>
        </div>

        <div className="panel__row panel__row--seats">
          {Array.from({ length: draft.players }, (_, seat) => (
            <label key={seat}>
              {t('field.seat', { n: seat + 1 })}
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
                <option value="human">{t('seat.human')}</option>
                {BOT_CATALOGUE.map((bot) => (
                  <option key={bot.level} value={bot.level} disabled={!bot.available}>
                    {t(bot.nameKey)}
                    {bot.available ? '' : t('seat.soon')}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <p className="hint">{describeBots(draft.bots.slice(0, draft.players), t)}</p>

        <RulesPanel config={draft.config} onChange={(config) => setDraft({ ...draft, config })} />

        {verdict.errors.length > 0 ? (
          <p className="problem problem--error">
            {verdict.errors.map((p) => explain(p, t)).join(' ')}
          </p>
        ) : null}
        {verdict.warnings.length > 0 ? (
          <p className="problem problem--warn">
            {verdict.warnings.map((p) => explain(p, t)).join(' ')}
          </p>
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
  const t = useT();
  const net = useOnline(true);
  const [name, setName] = useState(() => net.savedName() || 'Hráč');
  const [code, setCode] = useState('');

  const seatName = (seat: number): string => {
    const occupant = net.room?.seats[seat];
    if (occupant === undefined || occupant.kind === 'empty') return t('player.seat', { n: seat + 1 });
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
            substituted: (seat) => {
              const occupant = net.room?.seats[seat];
              return occupant?.kind === 'human' && occupant.substituted;
            },
          }),
    // `seatName` closes over the room, so the room belongs in the deps.
    [net.view, net.room],
  );

  const log = useMemo(() => {
    const lines: string[] = [];
    for (const e of net.events) {
      const line = describePublicEvent(e, t, seatName);
      if (line !== null) lines.push(line);
    }
    return lines.slice(-12).reverse();
  }, [net.events, net.room]);

  const inGame = net.room !== null && net.room.phase === 'playing' && model !== null;

  return (
    <>
      <p className="lede">
        {t('mode.onlineLede')} <ConnectionBadge state={net.connection} />
      </p>

      {net.error !== null ? (
        <p className="problem problem--error" role="alert" onClick={net.clearError}>
          {explainError(net.error, t)}
        </p>
      ) : null}

      {net.room === null ? (
        <section className="panel">
          <div className="panel__row">
            <label>
              {t('field.name')}
              <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn btn--primary"
              disabled={net.connection !== 'online' || name.trim().length === 0}
              onClick={() => net.createRoom(name.trim(), DEFAULT_RULES)}
            >
              {t('action.createRoom')}
            </button>
          </div>
          <div className="panel__row">
            <label>
              {t('field.roomCode')}
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
              {t('action.join')}
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
  const t = useT();
  return <span className={`badge badge--${state}`}>{t(`conn.${state}`)}</span>;
}

// --- shared bits ------------------------------------------------------------

function ResultBanner({ result, seatName }: { result: GameResult; seatName: (seat: number) => string }) {
  const t = useT();
  const text =
    result.reason === 'stalemate'
      ? t('banner.stalemate')
      : result.durak === null
        ? t('banner.draw')
        : // Player ids are seat-derived ("p0" locally, "s0" on the server).
          t('banner.durak', { name: seatName(Number(result.durak.replace(/^\D+/, ''))) });
  return <section className={`banner${result.durak === null ? '' : ' banner--loss'}`}>{text}</section>;
}

function Log({ lines }: { lines: string[] }) {
  const t = useT();
  return (
    <section className="log">
      <h2>{t('log.title')}</h2>
      <ol>
        {lines.map((line, i) => (
          <li key={`${i}-${line}`}>{line}</li>
        ))}
      </ol>
    </section>
  );
}

function describeBots(bots: readonly (BotLevel | null)[], t: Translate): string {
  const levels = bots.filter((b): b is BotLevel => b !== null);
  if (levels.length === 0) return t('bots.hint.none');
  return [...new Set(levels)]
    .map((l) => BOT_CATALOGUE.find((b) => b.level === l))
    .filter((b) => b !== undefined)
    .map((b) => `${t(b.nameKey)} — ${t(b.blurbKey)}`)
    .join(' ');
}

/** Server error codes and rule warnings share one lookup: code in, sentence out. */
const explainError = (code: string, t: Translate): string => {
  const message = t(`error.${code}`);
  return message === `error.${code}` ? t('error.unknown', { code }) : message;
};

const explain = (problem: ConfigProblem, t: Translate): string =>
  t(`problem.${problem.code}`, problem.params ?? {});

export default App;
