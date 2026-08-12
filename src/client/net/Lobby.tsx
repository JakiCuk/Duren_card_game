import { useState } from 'react';
import { BOT_CATALOGUE, type BotLevel } from '../../bots/index.js';
import type { ChatLine, RoomState } from '../../shared/protocol.js';
import { MIN_PLAYERS, type RuleConfig } from '../../shared/rules.js';
import { RulesPanel } from '../game/RulesPanel.js';

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
            Izba <code className="code">{room.code}</code>
          </h2>
          <p className="hint">
            Pošli tento kód alebo odkaz komukoľvek, kto sa má pridať. Netreba registráciu.
          </p>
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
            {copied ? 'Skopírované' : 'Kopírovať odkaz'}
          </button>
          <button type="button" className="btn" onClick={props.onLeave}>
            Opustiť izbu
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
                {room.hostId && seat === room.seats.findIndex((s) => s.kind === 'human' && s.playerId === room.hostId)
                  ? ' · hostiteľ'
                  : ''}
                {seat === mySeat ? ' · ty' : ''}
                {occupant.connected ? '' : ' · odpojený'}
              </span>
            ) : occupant.kind === 'bot' ? (
              <span className="lobby__who">
                {occupant.name} · {BOT_CATALOGUE.find((b) => b.level === occupant.level)?.name}
              </span>
            ) : (
              <span className="lobby__who lobby__who--empty">voľné</span>
            )}

            <span className="lobby__seatActions">
              {occupant.kind === 'empty' && mySeat !== seat ? (
                <button type="button" className="btn btn--ghost" onClick={() => props.onSeat(seat)}>
                  Sadnúť si sem
                </button>
              ) : null}
              {occupant.kind === 'empty' && isHost
                ? BOT_CATALOGUE.filter((b) => b.available).map((bot) => (
                    <button
                      key={bot.level}
                      type="button"
                      className="btn btn--ghost"
                      title={bot.blurb}
                      onClick={() => props.onAddBot(seat, bot.level)}
                    >
                      + {bot.name}
                    </button>
                  ))
                : null}
              {occupant.kind === 'bot' && isHost ? (
                <button type="button" className="btn btn--ghost" onClick={() => props.onRemoveBot(seat)}>
                  Odobrať
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ol>

      {isHost ? (
        <RulesPanel config={room.config} onChange={props.onConfig} />
      ) : (
        <p className="hint">Pravidlá nastavuje hostiteľ.</p>
      )}

      {room.problems.errors.length > 0 ? (
        <p className="problem problem--error">{room.problems.errors.map(explainRoom).join(' ')}</p>
      ) : null}
      {room.problems.warnings.length > 0 ? (
        <p className="problem problem--warn">{room.problems.warnings.map(explainRoom).join(' ')}</p>
      ) : null}

      <div className="panel__row">
        <button type="button" className="btn btn--primary" disabled={!canStart} onClick={props.onStart}>
          {room.phase === 'finished' ? 'Odveta' : 'Začať hru'}
        </button>
        {!isHost ? <span className="hint">Hru spúšťa hostiteľ.</span> : null}
      </div>

      <Chat lines={props.chat} onSend={props.onChat} />
    </section>
  );
}

export function Chat({ lines, onSend }: { lines: ChatLine[]; onSend: (text: string) => void }) {
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
          placeholder="Napíš niečo…"
          aria-label="Správa do chatu"
        />
        <button type="submit" className="btn">
          Poslať
        </button>
      </form>
    </div>
  );
}

function explainRoom(code: string): string {
  switch (code) {
    case 'not_enough_players':
      return 'Na hru treba aspoň dvoch — pridaj hráča alebo bota.';
    case 'deck_too_small':
      return 'Balík nestačí pre toľkých hráčov. Prepni na 52 kariet.';
    case 'deck_barely_sufficient':
      return 'Po rozdaní zostane veľmi málo kariet.';
    case 'must_beat_all_changes_the_game':
      return 'Pravidlo „musí zbiť" berie obrancovi voľbu.';
    case 'transfer_two_players':
      return 'Vo dvojici sa prehodený útok vracia späť na útočníka.';
    default:
      return code;
  }
}
