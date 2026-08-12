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
  chat: ChatLine[];
  onConfig: (config: RuleConfig) => void;
  onSeat: (seat: number) => void;
  onAddBot: (seat: number, level: BotLevel) => void;
  onRemoveBot: (seat: number) => void;
  onStart: () => void;
  onLeave: () => void;
  onChat: (text: string) => void;
}

const shareUrl = (code: string): string =>
  typeof window === 'undefined' ? code : `${window.location.origin}/#/r/${code}`;

export function Lobby(props: LobbyProps) {
  const t = useT();
  const { room, mySeat, playerId } = props;
  const isHost = room.hostId === playerId;
  const occupied = room.seats.filter((s) => s.kind !== 'empty').length;
  const canStart = isHost && occupied >= MIN_PLAYERS && room.problems.errors.length === 0;
  const [copied, setCopied] = useState(false);

  return (
    <section className="lobby">
      <header className="lobby__head">
        <div>
          <h2>
            {t('lobby.room')} <code className="code">{room.code}</code>
          </h2>
          <p className="hint">{t('lobby.shareHint')}</p>
        </div>
        <div className="lobby__actions">
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
          <button type="button" className="btn" onClick={props.onLeave}>
            {t('action.leave')}
          </button>
        </div>
      </header>

      <ol className="lobby__seats">
        {room.seats.map((occupant, seat) => (
          <li key={seat} className={`lobby__seat lobby__seat--${occupant.kind}`}>
            <span className="lobby__seatNo">{seat + 1}.</span>

            {occupant.kind === 'human' ? (
              <span className="lobby__who">
                {occupant.name}
                {occupant.playerId === room.hostId ? ` · ${t('lobby.host')}` : ''}
                {seat === mySeat ? ` · ${t('lobby.you')}` : ''}
                {occupant.connected ? '' : ` · ${t('role.away')}`}
                {occupant.substituted ? ` · ${t('role.substituted')}` : ''}
              </span>
            ) : occupant.kind === 'bot' ? (
              <span className="lobby__who">
                {occupant.name} ·{' '}
                {t(BOT_CATALOGUE.find((b) => b.level === occupant.level)?.nameKey ?? '')}
              </span>
            ) : (
              <span className="lobby__who lobby__who--empty">{t('lobby.free')}</span>
            )}

            <span className="lobby__seatActions">
              {occupant.kind === 'empty' && mySeat !== seat ? (
                <button type="button" className="btn btn--ghost" onClick={() => props.onSeat(seat)}>
                  {t('action.sitHere')}
                </button>
              ) : null}
              {occupant.kind === 'empty' && isHost
                ? BOT_CATALOGUE.filter((b) => b.available).map((bot) => (
                    <button
                      key={bot.level}
                      type="button"
                      className="btn btn--ghost"
                      title={t(bot.blurbKey)}
                      onClick={() => props.onAddBot(seat, bot.level)}
                    >
                      {t('lobby.addBot', { name: t(bot.nameKey) })}
                    </button>
                  ))
                : null}
              {occupant.kind === 'bot' && isHost ? (
                <button type="button" className="btn btn--ghost" onClick={() => props.onRemoveBot(seat)}>
                  {t('action.removeBot')}
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ol>

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

      <div className="panel__row">
        <button type="button" className="btn btn--primary" disabled={!canStart} onClick={props.onStart}>
          {room.phase === 'finished' ? t('action.rematch') : t('action.start')}
        </button>
        {!isHost ? <span className="hint">{t('lobby.startByHost')}</span> : null}
      </div>

      <Chat lines={props.chat} onSend={props.onChat} />
    </section>
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

/** Room problems arrive as codes; the dictionary turns them into sentences. */
function explainRoom(code: string, t: Translate): string {
  const message = t(`problem.${code}`);
  return message === `problem.${code}` ? code : message;
}
