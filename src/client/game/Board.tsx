import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { cardCode, rankOf, suitOf, type CardId, type Move, type Seat } from '../../engine/index.js';
import { CardBackStack, CardFace } from '../cards/CardFace.js';
import { useT, type Translate } from '../i18n/index.js';
import type { BoardModel, BoardSeat } from './model.js';

const SUIT_GLYPH = ['♣', '♦', '♥', '♠'] as const;
const SUIT_KEY = ['suit.clubs', 'suit.diamonds', 'suit.hearts', 'suit.spades'] as const;

export interface BoardProps {
  model: BoardModel;
  play: (move: Move) => void;
  /** True while this player could still add a card, so the table can say so. */
  awaitingThrowIn?: boolean;
}

/**
 * A round table seen from your own chair.
 *
 * Everything sits where it would if you pulled up a seat: your hand along the
 * bottom edge, the other players around the far side, the pile in the middle,
 * and the buttons that act on it directly underneath. Whoever you are playing
 * rotates to the bottom, so the layout never asks you to work out which of six
 * panels is yours.
 */
export function Board({ model, play, awaitingThrowIn = false }: BoardProps) {
  const t = useT();
  const [seat, setSeat] = useState<Seat>(model.controllable[0] ?? 0);
  const [slot, setSlot] = useState(0);

  const firstUnbeaten = model.table.findIndex((x) => x.defence === null);

  useEffect(() => {
    if (model.controllable.length > 0 && !model.controllable.includes(seat)) {
      setSeat(model.controllable[0]!);
    }
  }, [model.controllable, seat]);
  useEffect(() => {
    if (model.table[slot]?.defence !== null) setSlot(firstUnbeaten === -1 ? 0 : firstUnbeaten);
  }, [model.table, slot, firstUnbeaten]);

  const moves = useMemo(
    () => (model.controllable.includes(seat) ? model.movesFor(seat) : []),
    [model, seat],
  );
  const isDefender = seat === model.defenderSeat;

  const playableCards = useMemo(() => {
    const set = new Map<CardId, Move>();
    for (const m of moves) {
      if (m.t === 'ATTACK') set.set(m.card, m);
      if (m.t === 'DEFEND' && m.slot === slot) set.set(m.card, m);
    }
    return set;
  }, [moves, slot]);

  const takeMove = moves.find((m) => m.t === 'TAKE');
  const passMove = moves.find((m) => m.t === 'PASS');
  const transfers = moves.filter((m) => m.t === 'TRANSFER');

  const meIndex = Math.max(
    model.seats.findIndex((p) => p.seat === seat),
    0,
  );
  const me = model.seats[meIndex]!;
  const others = rotate(model.seats, meIndex).slice(1);
  const seatName = (s: Seat): string =>
    model.seats.find((x) => x.seat === s)?.name ?? t('player.seat', { n: s + 1 });

  return (
    <div className="board">
      <div className="board__status">
        <span className="chip" title={t('board.trumpIs', { suit: t(SUIT_KEY[model.trump]) })}>
          {t('board.trump')}{' '}
          <strong className={model.trump === 1 || model.trump === 2 ? 'red' : ''}>
            {SUIT_GLYPH[model.trump]}
          </strong>
        </span>
        <span className="chip">{t('board.bout', { n: model.boutIndex + 1 })}</span>
        <span className="chip">{t('board.deck', { n: model.deckCount })}</span>
        <span className="chip">{t('board.discard', { n: model.discardCount })}</span>
      </div>

      <div className="felt">
        {others.map((p, i) => (
          <Opponent key={p.seat} player={p} model={model} style={seatPosition(i + 1, model.seats.length)} />
        ))}

        <div className="felt__deck">
          {model.deckCount > 0 ? (
            <>
              {model.trumpCard !== null ? (
                <span className="deck__trump">
                  <CardFace card={model.trumpCard} size="sm" title={t('board.trumpCard')} />
                </span>
              ) : null}
              <CardBackStack count={model.deckCount} size="sm" />
            </>
          ) : (
            <span className="deck__empty">{t('board.deckEmpty')}</span>
          )}
        </div>

        <div className="felt__centre">
          <div className="table" aria-label={t('board.table')}>
            {model.table.length === 0 ? (
              <p className="table__hint">
                {model.finished
                  ? t('board.gameOver')
                  : t('board.attacks', { name: seatName(model.attackerSeat) })}
              </p>
            ) : (
              model.table.map((pair, i) => (
                <div
                  key={`${pair.attack}-${i}`}
                  className={`pair${i === slot && pair.defence === null ? ' pair--target' : ''}`}
                >
                  <CardFace
                    card={pair.attack}
                    size="md"
                    {...(pair.defence === null && isDefender ? { onClick: () => setSlot(i) } : {})}
                    title={pair.defence === null ? t('board.unbeatenHint') : cardCode(pair.attack)}
                  />
                  {pair.defence !== null ? (
                    <span className="pair__defence">
                      <CardFace card={pair.defence} size="md" />
                    </span>
                  ) : null}
                </div>
              ))
            )}
          </div>

          <div className="actions">
            {takeMove ? (
              <button type="button" className="btn btn--warn" onClick={() => play(takeMove)}>
                {t('action.take')}
              </button>
            ) : null}
            {transfers.map((m) => (
              <button
                key={`${m.card}-${String(m.reveal)}`}
                type="button"
                className="btn"
                onClick={() => play(m)}
                title={m.reveal ? t('rules.reveal.hint') : t('rules.transfer.hint')}
              >
                {m.reveal
                  ? t('action.transferReveal', { card: cardCode(m.card) })
                  : t('action.transfer', { card: cardCode(m.card) })}
              </button>
            ))}
            {passMove ? (
              <button
                type="button"
                className={`btn${awaitingThrowIn ? ' btn--primary' : ''}`}
                onClick={() => play(passMove)}
              >
                {t('action.pass')}
              </button>
            ) : null}
            {model.controllable
              .filter((s) => s !== seat)
              .map((s) => (
                <button key={s} type="button" className="btn btn--ghost" onClick={() => setSeat(s)}>
                  {t('action.switchTo', { name: seatName(s) })}
                </button>
              ))}
          </div>

          <p className={`felt__prompt${awaitingThrowIn ? ' felt__prompt--wait' : ''}`}>
            {awaitingThrowIn
              ? t('board.yourThrowIn')
              : model.controllable.length === 0 && !model.finished
                ? t('board.waiting')
                : ' '}
          </p>
        </div>
      </div>

      <Me player={me} model={model} playable={playableCards} play={play} />
    </div>
  );
}

/** Somebody sitting across the table: a name plate and a fan of backs. */
function Opponent({
  player,
  model,
  style,
}: {
  player: BoardSeat;
  model: BoardModel;
  style: CSSProperties;
}) {
  const t = useT();
  return (
    <section
      aria-label={player.name}
      className={`seat seat--across${roleClasses(player, model)}`}
      style={style}
    >
      <header className="seat__head">
        <span className="seat__name">{player.name}</span>
        {player.team === null ? null : (
          <span className="seat__team">{t('team.name', { n: player.team + 1 })}</span>
        )}
        <span className="seat__count">{t('board.cards', { count: player.handCount })}</span>
      </header>
      <span className="seat__roles">{roleLabels(player, model, t).join(' · ') || ' '}</span>
      <div className="hand hand--fan">
        {player.hand === null
          ? // Somebody else's cards must never reach the DOM, not even as an alt
            // attribute. The fan is capped so a nine-card hand does not sprawl.
            Array.from({ length: Math.min(player.handCount, 8) }, (_, i) => (
              <CardFace key={i} card={0} faceDown size="sm" />
            ))
          : player.hand.map((c) => <CardFace key={c} card={c} size="sm" />)}
        {player.handCount === 0 ? <span className="hand__empty">{t('board.noCards')}</span> : null}
      </div>
    </section>
  );
}

/** The near edge of the table: your own hand, large and clickable. */
function Me({
  player,
  model,
  playable,
  play,
}: {
  player: BoardSeat;
  model: BoardModel;
  playable: Map<CardId, Move>;
  play: (move: Move) => void;
}) {
  const t = useT();
  const canAct = model.actors.includes(player.seat);

  return (
    <section aria-label={player.name} className={`seat seat--me${roleClasses(player, model)}`}>
      <header className="seat__head">
        <span className="seat__name">{player.name}</span>
        {player.team === null ? null : (
          <span className="seat__team">{t('team.name', { n: player.team + 1 })}</span>
        )}
        <span className="seat__roles">{roleLabels(player, model, t).join(' · ') || ' '}</span>
        <span className="seat__count">{t('board.cards', { count: player.handCount })}</span>
      </header>

      <div className="hand">
        {player.hand === null
          ? Array.from({ length: player.handCount }, (_, i) => (
              <CardFace key={i} card={0} faceDown size="md" />
            ))
          : sortForDisplay(player.hand, model.trump).map((cardId) => {
              const move = playable.get(cardId);
              return (
                <CardFace
                  key={cardId}
                  card={cardId}
                  size="md"
                  muted={move === undefined && canAct}
                  {...(move ? { onClick: () => play(move) } : {})}
                />
              );
            })}
        {player.handCount === 0 ? <span className="hand__empty">{t('board.noCards')}</span> : null}
      </div>
    </section>
  );
}

function roleLabels(p: BoardSeat, model: BoardModel, t: Translate): string[] {
  const roles: string[] = [];
  if (p.isBot) roles.push(t('role.bot'));
  if (!p.connected) roles.push(t('role.away'));
  if (p.substituted) roles.push(t('role.substituted'));
  if (p.seat === model.attackerSeat) roles.push(t('role.attacks'));
  if (p.seat === model.defenderSeat) {
    roles.push(model.defenderTaking ? t('role.takes') : t('role.defends'));
  }
  if (p.out) roles.push(t('role.out'));
  else if (p.passed) roles.push(t('role.passed'));
  return roles;
}

const roleClasses = (p: BoardSeat, model: BoardModel): string =>
  `${model.actors.includes(p.seat) ? ' seat--can-act' : ''}` +
  `${p.seat === model.attackerSeat ? ' seat--attacker' : ''}` +
  `${p.seat === model.defenderSeat ? ' seat--defender' : ''}` +
  `${p.connected ? '' : ' seat--away'}` +
  `${p.team === null ? '' : ` seat--team${p.team}`}`;

/** Index 0 is always you at the bottom; the rest go round from there. */
function seatPosition(index: number, total: number): CSSProperties {
  const angle = Math.PI / 2 + (index * 2 * Math.PI) / total;
  return {
    left: `${50 + 41 * Math.cos(angle)}%`,
    top: `${50 + 40 * Math.sin(angle)}%`,
  };
}

const rotate = <T,>(items: readonly T[], by: number): T[] => [
  ...items.slice(by),
  ...items.slice(0, by),
];

/**
 * Display order only: plain suits grouped and ascending, trumps last. The
 * engine keeps hands in card-id order for hashing; how they look is a client
 * decision.
 */
function sortForDisplay(hand: readonly CardId[], trump: number): CardId[] {
  return [...hand].sort((a, b) => {
    const at = suitOf(a) === trump ? 1 : 0;
    const bt = suitOf(b) === trump ? 1 : 0;
    if (at !== bt) return at - bt;
    if (suitOf(a) !== suitOf(b)) return suitOf(a) - suitOf(b);
    return rankOf(a) - rankOf(b);
  });
}
