import { useMemo, useState } from 'react';
import { BOT_CATALOGUE, type BotLevel } from '../bots/index.js';
import type { GameResult } from '../engine/index.js';
import {
  DEFAULT_RULES,
  validateConfig,
  type ConfigProblem,
  type RuleConfig,
} from '../shared/rules.js';
import { CLIENT_VERSION } from '../shared/version.js';
import { Board } from './game/Board.js';
import { describeEvent, describePublicEvent } from './game/log.js';
import { modelFromState, modelFromView } from './game/model.js';
import { RulesPanel } from './game/RulesPanel.js';
import { defaultSetup, useLocalGame, type LocalGameSetup } from './game/useLocalGame.js';
import { useI18n, useT, type Translate } from './i18n/index.js';
import { Chat, Lobby } from './net/Lobby.js';
import { useOnline } from './net/useOnline.js';
import { SettingsPanel } from './settings/SettingsPanel.js';
import { useSettings, type Settings } from './settings/useSettings.js';
import { Shell, StatusChip, type MenuSpec, type Mode } from './Shell.js';

type SetSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => void;

interface ModeProps {
  mode: Mode;
  setMode: (mode: Mode) => void;
  settings: Settings;
  set: SetSetting;
}

export function App() {
  const [mode, setMode] = useState<Mode>('local');
  const { settings, set } = useSettings();
  const shared = { mode, setMode, settings, set };

  return mode === 'local' ? <LocalGame {...shared} /> : <OnlineGame {...shared} />;
}

// --- on this device ---------------------------------------------------------

function LocalGame({ mode, setMode, settings, set }: ModeProps) {
  const t = useT();
  // A player at the table, not a chair in the setup panel — different words on
  // purpose, so the two never collide in the UI.
  const localSeatName = (seat: number): string => t('player.seat', { n: seat + 1 });
  const game = useLocalGame(defaultSetup(), {
    botDelayMs: settings.botDelayMs,
    holdForThrowIn: settings.holdForThrowIn,
  });
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
    return lines.slice(-14).reverse();
  }, [game.events, t]);

  const menus: MenuSpec[] = [
    {
      id: 'settings',
      label: t('setup.title'),
      body: (
        <>
          <div className="panel__row">
            <label>
              {t('field.players')}
              <select
                value={draft.players}
                onChange={(e) => {
                  const players = Number(e.target.value);
                  const bots = Array.from(
                    { length: players },
                    (_, i) => draft.bots[i] ?? (i === 0 ? null : 2),
                  );
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
                    config: {
                      ...draft.config,
                      deckSize: Number(e.target.value) as RuleConfig['deckSize'],
                    },
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
                        i === seat
                          ? e.target.value === 'human'
                            ? null
                            : (Number(e.target.value) as BotLevel)
                          : b,
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

          <div className="panel__row">
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

          <hr className="menu__rule" />
          <SettingsPanel settings={settings} set={set} />
        </>
      ),
    },
    {
      id: 'rules',
      label: t('rules.title'),
      body: <RulesPanel config={draft.config} onChange={(config) => setDraft({ ...draft, config })} />,
    },
  ];

  return (
    <Shell
      mode={mode}
      setMode={setMode}
      settings={settings}
      set={set}
      menus={menus}
      status={<StatusChip>{t('mode.local')}</StatusChip>}
    >
      {/* Rule problems sit in the open, not inside the drawer that caused them:
          a warning nobody can see while the table is on screen is no warning. */}
      {verdict.errors.length > 0 ? (
        <p className="problem problem--error sheet">
          {verdict.errors.map((p) => explain(p, t)).join(' ')}
        </p>
      ) : null}
      {verdict.warnings.length > 0 ? (
        <p className="problem problem--warn sheet">
          {verdict.warnings.map((p) => explain(p, t)).join(' ')}
        </p>
      ) : null}

      <div className="stage">
        {game.state.result ? (
          <ResultBanner result={game.state.result} seatName={localSeatName} />
        ) : null}
        <Board
          model={model}
          play={game.play}
          awaitingThrowIn={settings.holdForThrowIn && game.pendingThrowIn !== null}
          showStatus={settings.showStatus}
        />
        {settings.showLog ? <Log lines={log} /> : null}
      </div>
      <Footer />
    </Shell>
  );
}

// --- online room ------------------------------------------------------------

function OnlineGame({ mode, setMode, settings, set }: ModeProps) {
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
    return lines.slice(-14).reverse();
  }, [net.events, net.room]);

  const inGame = net.room !== null && net.room.phase === 'playing' && model !== null;

  const menus: MenuSpec[] = [
    {
      id: 'settings',
      label: t('settings.title'),
      body: <SettingsPanel settings={settings} set={set} />,
    },
    ...(net.room !== null
      ? [
          {
            id: 'chat',
            label: t('lobby.chat'),
            badge: net.chat.length,
            alignRight: true,
            body: <Chat lines={net.chat} onSend={net.sendChat} />,
          },
        ]
      : []),
  ];

  const tone = net.connection === 'online' ? 'ok' : net.connection;

  return (
    <Shell
      mode={mode}
      setMode={setMode}
      settings={settings}
      set={set}
      menus={menus}
      {...(net.room !== null ? { onLeave: net.leaveRoom } : {})}
      status={
        <StatusChip tone={tone}>
          {net.room === null ? t(`conn.${net.connection}`) : `${t('lobby.room')} ${net.room.code}`}
        </StatusChip>
      }
    >
      {net.error !== null ? (
        <p className="problem problem--error sheet" role="alert" onClick={net.clearError}>
          {explainError(net.error, t)}
        </p>
      ) : null}

      {net.room === null ? (
        <Entry
          name={name}
          setName={setName}
          code={code}
          setCode={setCode}
          canAct={net.connection === 'online'}
          onCreate={() => net.createRoom(name.trim(), DEFAULT_RULES)}
          onJoin={() => net.joinRoom(code.trim(), name.trim())}
        />
      ) : null}

      {net.room !== null && !inGame ? (
        <Lobby
          room={net.room}
          mySeat={net.mySeat}
          playerId={net.playerId ?? ''}
          onConfig={net.setConfig}
          onSeat={net.takeSeat}
          onAddBot={net.addBot}
          onRemoveBot={net.removeBot}
          onStart={net.room.phase === 'finished' ? net.rematch : net.start}
        />
      ) : null}

      {inGame && model !== null ? (
        <div className="stage">
          {model.result ? <ResultBanner result={model.result} seatName={seatName} /> : null}
          <Board
            model={model}
            showStatus={settings.showStatus}
            play={(move) => {
              if (net.view) net.move(net.view.seq, move);
            }}
          />
          {settings.showLog ? <Log lines={log} /> : null}
        </div>
      ) : null}
      <Footer />
    </Shell>
  );
}

/**
 * The way in: a name, and either a new room or somebody else's code.
 *
 * No account, no password — the design's sign-in column becomes the two things
 * this game actually needs, because inventing a login for a room that lives in
 * server memory would be theatre.
 */
function Entry({
  name,
  setName,
  code,
  setCode,
  canAct,
  onCreate,
  onJoin,
}: {
  name: string;
  setName: (value: string) => void;
  code: string;
  setCode: (value: string) => void;
  canAct: boolean;
  onCreate: () => void;
  onJoin: () => void;
}) {
  const t = useT();
  return (
    <div className="sheet entry">
      <div>
        <div className="kicker">{t('entry.kicker')}</div>
        <h1>{t('entry.title')}</h1>
        <p className="entry__lede">{t('mode.onlineLede')}</p>

        <div className="entry__form">
          <label className="field">
            <span>{t('field.name')}</span>
            <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
          </label>
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={!canAct || name.trim().length === 0}
            onClick={onCreate}
          >
            {t('action.createRoom')}
          </button>

          <label className="field">
            <span>{t('field.roomCode')}</span>
            <input
              value={code}
              maxLength={5}
              placeholder="ABC12"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
          </label>
          <button
            type="button"
            className="btn btn--block"
            disabled={!canAct || code.trim().length !== 5}
            onClick={onJoin}
          >
            {t('action.join')}
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="kicker">{t('entry.botsKicker')}</div>
        <h3>{t('entry.botsTitle')}</h3>
        <ul className="entry__bots">
          {BOT_CATALOGUE.filter((b) => b.available).map((bot) => (
            <li key={bot.level}>
              <strong>{t(bot.nameKey)}</strong>
              <span>{t(bot.blurbKey)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// --- shared bits ------------------------------------------------------------

function ResultBanner({
  result,
  seatName,
}: {
  result: GameResult;
  seatName: (seat: number) => string;
}) {
  const t = useT();
  const text =
    result.reason === 'stalemate'
      ? t('banner.stalemate')
      : result.loserTeam !== null
        ? // With teams the loss belongs to the side, not to one player.
          t('banner.teamLost', { team: t('team.name', { n: result.loserTeam + 1 }) })
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

function Footer() {
  const { t } = useI18n();
  return (
    <footer className="footer">
      <span>v{CLIENT_VERSION}</span>
      <span>
        <a href="https://tekeye.uk" rel="noreferrer noopener" target="_blank">
          {t('app.cardsCredit')}
        </a>
      </span>
    </footer>
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
