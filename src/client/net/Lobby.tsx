import { useState } from 'react';
import { BOT_CATALOGUE, type BotLevel } from '../../bots/index.js';
import type { ChatLine, RoomState } from '../../shared/protocol.js';
import { MIN_PLAYERS, type RuleConfig } from '../../shared/rules.js';
import { RulesPanel } from '../game/RulesPanel.js';
import { useT, type Translate } from '../i18n/index.js';

export interface LobbyProps {
  room: RoomState;
  mySeat: number | null;
  playerId: string;
  onConfig: (config: RuleConfig) => void;
  onSeat: (seat: number) => void;
  onAddBot: (seat: number, level: BotLevel) => void;
  onRemoveBot: (seat: number) => void;
  onStart: () => void;
}

const shareUrl = (code: string): string =>
  typeof window === 'undefined' ? code : `${window.location.origin}/#/r/${code}`;

/**
 * The waiting room: who is here, what the table is set to, and the one button
 * that starts it.
 *
 * Chat and leaving live in the header, not here — they belong to the room as a
 * whole, and duplicating them would give the same action two homes.
 */
export function Lobby(props: LobbyProps) {
  const t = useT();
  const { room, mySeat, playerId } = props;
  const isHost = room.hostId === playerId;
  const occupied = room.seats.filter((s) => s.kind !== 'empty').length;
  const canStart = isHost && occupied >= MIN_PLAYERS && room.problems.errors.length === 0;
  const [copied, setCopied] = useState(false);

  return (
    <div className="sheet">
      <header className="lobby__head">
        <div>
          <div className="kicker">
            {t('lobby.room')} <span className="code">{room.code}</span>
          </div>
          <h1>{t('lobby.waitingTitle')}</h1>
          <p className="hint">
            {t('lobby.seatsFilled', { n: occupied, max: room.seats.length })} · {t('lobby.shareHint')}
          </p>
        </div>
        <div className="panel__row">
          <button
            type="button"
            className="btn"
            onClick={() => {
              void navigator.clipboard?.writeText(shareUrl(room.code));
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? t('action.copied') : t('action.copyLink')}
          </button>
          <button type="button" className="btn btn--primary" disabled={!canStart} onClick={props.onStart}>
            {room.phase === 'finished' ? t('action.rematch') : t('action.start')}
          </button>
        </div>
      </header>

      <ol className="lobby__seats">
        {room.seats.map((occupant, seat) => (
          <li key={seat} className={`lobby__seat lobby__seat--${occupant.kind}`}>
            <span className="avatar">{occupant.kind === 'empty' ? '+' : initials(occupant.name)}</span>

            <span className="lobby__who">
              <span className="lobby__name">
                {occupant.kind === 'empty' ? t('lobby.free') : occupant.name}
              </span>
              <span className="lobby__meta">{describeSeat(occupant, seat, room, mySeat, t)}</span>
            </span>

            {occupant.kind === 'empty' ? (
              <span className="tag tag--outline">{t('lobby.invite')}</span>
            ) : (
              <span className="tag tag--accent">{t('lobby.seated')}</span>
            )}

            <span className="lobby__seatActions">
              {occupant.kind === 'empty' && mySeat !== seat ? (
                <button type="button" className="btn" onClick={() => props.onSeat(seat)}>
                  {t('action.sitHere')}
                </button>
              ) : null}
              {occupant.kind === 'empty' && isHost
                ? BOT_CATALOGUE.filter((b) => b.available).map((bot) => (
                    <button
                      key={bot.level}
                      type="button"
                      className="btn"
                      title={t(bot.blurbKey)}
                      onClick={() => props.onAddBot(seat, bot.level)}
                    >
                      {t('lobby.addBot', { name: t(bot.nameKey) })}
                    </button>
                  ))
                : null}
              {occupant.kind === 'bot' && isHost ? (
                <button type="button" className="btn" onClick={() => props.onRemoveBot(seat)}>
                  {t('action.removeBot')}
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ol>

      <div className="lobby__cols">
        <div className="panel">
          <div className="kicker">{t('rules.title')}</div>
          {isHost ? (
            <RulesPanel config={room.config} onChange={props.onConfig} />
          ) : (
            <p className="hint">{t('lobby.rulesByHost')}</p>
          )}

          {room.problems.errors.length > 0 ? (
            <p className="problem problem--error">
              {room.problems.errors.map((c) => explainRoom(c, t)).join(' ')}
            </p>
          ) : null}
          {room.problems.warnings.length > 0 ? (
            <p className="problem problem--warn">
              {room.problems.warnings.map((c) => explainRoom(c, t)).join(' ')}
            </p>
          ) : null}
          {isHost ? null : <p className="hint">{t('lobby.startByHost')}</p>}
        </div>

        <div className="panel">
          <div className="kicker">{t('lobby.facts')}</div>
          <div className="lobby__facts">
            <div className="lobby__fact">
              <span>{t('field.deck')}</span>
              <b>{t(`deck.${room.config.deckSize}`)}</b>
            </div>
            <div className="lobby__fact">
              <span>{t('lobby.fact.seats')}</span>
              <b>
                {occupied} / {room.seats.length}
              </b>
            </div>
            <div className="lobby__fact">
              <span>{t('rules.transfer')}</span>
              <b>{room.config.transfer.enabled ? t('yes') : t('no')}</b>
            </div>
            <div className="lobby__fact">
              <span>{t('lobby.fact.code')}</span>
              <b className="code">{room.code}</b>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Chat({ lines, onSend }: { lines: ChatLine[]; onSend: (text: string) => void }) {
  const t = useT();
  const [text, setText] = useState('');
  return (
    <div className="chat">
      <ol className="chat__lines">
        {lines.map((line, i) => (
          <li key={`${line.at}-${i}`}>
            <strong>{line.name}:</strong> {line.text}
          </li>
        ))}
      </ol>
      <form
        className="chat__form"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = text.trim();
          if (trimmed.length === 0) return;
          onSend(trimmed);
          setText('');
        }}
      >
        <input
          value={text}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('lobby.chatPlaceholder')}
          aria-label={t('lobby.chatLabel')}
        />
        <button type="submit" className="btn">
          {t('action.send')}
        </button>
      </form>
    </div>
  );
}

/** The small grey line under a name: role, level, and whether they are here. */
function describeSeat(
  occupant: RoomState['seats'][number],
  seat: number,
  room: RoomState,
  mySeat: number | null,
  t: Translate,
): string {
  if (occupant.kind === 'empty') return t('lobby.freeHint');
  if (occupant.kind === 'bot') {
    return t(BOT_CATALOGUE.find((b) => b.level === occupant.level)?.nameKey ?? 'role.bot');
  }
  const parts: string[] = [];
  if (occupant.playerId === room.hostId) parts.push(t('lobby.host'));
  if (seat === mySeat) parts.push(t('lobby.you'));
  if (!occupant.connected) parts.push(t('role.away'));
  if (occupant.substituted) parts.push(t('role.substituted'));
  return parts.join(' · ') || t('lobby.player');
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return (words[0] ?? '?').slice(0, 2).toUpperCase();
}

/** Room problems arrive as codes; the dictionary turns them into sentences. */
function explainRoom(code: string, t: Translate): string {
  const message = t(`problem.${code}`);
  return message === `problem.${code}` ? code : message;
}
