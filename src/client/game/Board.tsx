import { useEffect, useMemo, useState } from 'react';
import { cardCode, rankOf, suitOf, type CardId, type Move, type Seat } from '../../engine/index.js';
import { CardBackStack, CardFace } from '../cards/CardFace.js';
import { useT } from '../i18n/index.js';
import type { BoardModel } from './model.js';

const SUIT_GLYPH = ['♣', '♦', '♥', '♠'] as const;
const SUIT_KEY = ['suit.clubs', 'suit.diamonds', 'suit.hearts', 'suit.spades'] as const;

export interface BoardProps {
  model: BoardModel;
  play: (move: Move) => void;
}

/** Presentation only: it never asks where the model came from. */
export function Board({ model, play }: BoardProps) {
  const t = useT();
  const [seat, setSeat] = useState<Seat>(model.controllable[0] ?? 0);
  const [slot, setSlot] = useState(0);

  const firstUnbeaten = model.table.findIndex((t) => t.defence === null);

  // Keep the active seat on somebody this client may act for, and keep the
  // defence target on a slot that still needs covering.
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
  // Transfers get their own buttons rather than lighting up a card: the same
  // card is often both a legal defence and a legal transfer, so a click on it
  // would be ambiguous.
  const transfers = moves.filter((m) => m.t === 'TRANSFER');

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

      <div className="board__middle">
        <div className="deck">
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
                  title={
                    pair.defence === null ? t('board.unbeatenHint') : cardCode(pair.attack)
                  }
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
      </div>

      <div className="seats">
        {model.seats.map((p) => {
          const canAct = model.actors.includes(p.seat);
          const mine = model.controllable.includes(p.seat);
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

          return (
            <section
              key={p.seat}
              aria-label={p.name}
              className={`seat${p.seat === seat && mine ? ' seat--active' : ''}${canAct ? ' seat--can-act' : ''}${p.connected ? '' : ' seat--away'}`}
            >
              <header className="seat__head">
                <button
                  type="button"
                  className="seat__name"
                  onClick={() => setSeat(p.seat)}
                  disabled={!mine}
                  title={mine ? t('board.switchHint') : t('board.notYours')}
                >
                  {p.name}
                </button>
                <span className="seat__roles">{roles.join(' · ') || ' '}</span>
                <span className="seat__count">{t('board.cards', { count: p.handCount })}</span>
              </header>

              <div className="hand">
                {p.hand === null
                  ? // Somebody else's cards must never reach the DOM, not even as
                    // an alt attribute — otherwise hidden information is a lie
                    // anyone can check with dev tools.
                    Array.from({ length: p.handCount }, (_, i) => (
                      <CardFace key={i} card={0} faceDown size="md" />
                    ))
                  : sortForDisplay(p.hand, model.trump).map((cardId) => {
                      const move = p.seat === seat ? playableCards.get(cardId) : undefined;
                      return (
                        <CardFace
                          key={cardId}
                          card={cardId}
                          size="md"
                          muted={p.seat === seat && move === undefined && canAct}
                          {...(move ? { onClick: () => play(move) } : {})}
                        />
                      );
                    })}
                {p.handCount === 0 ? <span className="hand__empty">{t('board.noCards')}</span> : null}
              </div>
            </section>
          );
        })}
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
          <button type="button" className="btn" onClick={() => play(passMove)}>
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
        {model.controllable.length > 1 ? (
          <span className="actions__note">{t('board.manyActors')}</span>
        ) : null}
        {model.controllable.length === 0 && !model.finished ? (
          <span className="actions__note">{t('board.waiting')}</span>
        ) : null}
      </div>
    </div>
  );
}

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
