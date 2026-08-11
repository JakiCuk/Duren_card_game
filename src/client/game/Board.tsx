import { useEffect, useMemo, useState } from 'react';
import {
  cardCode,
  rankOf,
  suitOf,
  type CardId,
  type GameState,
  type Move,
  type Seat,
} from '../../engine/index.js';
import { CardBackStack, CardFace } from '../cards/CardFace.js';

const SUIT_GLYPH = ['♣', '♦', '♥', '♠'] as const;
const SUIT_NAME = ['Kríže', 'Kára', 'Srdcia', 'Piky'] as const;

export interface BoardProps {
  state: GameState;
  actors: Seat[];
  movesFor: (seat: Seat) => Move[];
  play: (move: Move) => void;
  seatName: (seat: Seat) => string;
}

export function Board({ state, actors, movesFor, play, seatName }: BoardProps) {
  const [seat, setSeat] = useState<Seat>(actors[0] ?? 0);
  const [slot, setSlot] = useState(0);

  const firstUnbeaten = state.table.findIndex((t) => t.defence === null);

  // Keep the active seat on somebody who can actually move, and keep the
  // defence target on a slot that still needs covering.
  useEffect(() => {
    if (actors.length > 0 && !actors.includes(seat)) setSeat(actors[0]!);
  }, [actors, seat]);
  useEffect(() => {
    if (state.table[slot]?.defence !== null) setSlot(firstUnbeaten === -1 ? 0 : firstUnbeaten);
  }, [state.table, slot, firstUnbeaten]);

  const moves = useMemo(() => (actors.includes(seat) ? movesFor(seat) : []), [actors, seat, movesFor]);
  const isDefender = seat === state.defender;

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

  return (
    <div className="board">
      <div className="board__status">
        <span className="chip" title={`Tromf: ${SUIT_NAME[state.trump]}`}>
          Tromf <strong className={state.trump === 1 || state.trump === 2 ? 'red' : ''}>{SUIT_GLYPH[state.trump]}</strong>
        </span>
        <span className="chip">Kolo {state.boutIndex + 1}</span>
        <span className="chip">Balík {state.deck.length}</span>
        <span className="chip">Odhodené {state.discard.length}</span>
      </div>

      <div className="board__middle">
        <div className="deck">
          {state.deck.length > 0 ? (
            <>
              {state.trumpCard !== null && state.config.trumpCardVisible ? (
                <span className="deck__trump">
                  <CardFace card={state.trumpCard} size="sm" title="Tromfová karta na spodku balíka" />
                </span>
              ) : null}
              <CardBackStack count={state.deck.length} size="sm" />
            </>
          ) : (
            <span className="deck__empty">Balík je prázdny</span>
          )}
        </div>

        <div className="table" aria-label="Stôl">
          {state.table.length === 0 ? (
            <p className="table__hint">
              {state.phase === 'finished' ? 'Hra skončila.' : `${seatName(state.attacker)} útočí.`}
            </p>
          ) : (
            state.table.map((pair, i) => (
              <div
                key={`${pair.attack}-${i}`}
                className={`pair${i === slot && pair.defence === null ? ' pair--target' : ''}`}
              >
                <CardFace
                  card={pair.attack}
                  size="md"
                  {...(pair.defence === null && isDefender ? { onClick: () => setSlot(i) } : {})}
                  title={pair.defence === null ? 'Nezbité — klikni pre voľbu cieľa obrany' : cardCode(pair.attack)}
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
        {state.players.map((p) => {
          const canAct = actors.includes(p.seat);
          const roles: string[] = [];
          if (p.seat === state.attacker) roles.push('útočí');
          if (p.seat === state.defender) roles.push(state.defenderTaking ? 'berie' : 'bráni');
          if (p.outAtStep !== null) roles.push('vypadol z hry');
          else if (state.passed[p.seat]) roles.push('pasoval');

          return (
            <section
              key={p.seat}
              aria-label={seatName(p.seat)}
              className={`seat${p.seat === seat ? ' seat--active' : ''}${canAct ? ' seat--can-act' : ''}`}
            >
              <header className="seat__head">
                <button
                  type="button"
                  className="seat__name"
                  onClick={() => setSeat(p.seat)}
                  disabled={!canAct}
                  title={canAct ? 'Prepnúť na tohto hráča' : 'Tento hráč teraz nie je na ťahu'}
                >
                  {seatName(p.seat)}
                </button>
                <span className="seat__roles">{roles.join(' · ') || ' '}</span>
                <span className="seat__count">{p.hand.length} kariet</span>
              </header>

              <div className="hand">
                {sortForDisplay(p.hand, state.trump).map((card) => {
                  const move = p.seat === seat ? playableCards.get(card) : undefined;
                  return (
                    <CardFace
                      key={card}
                      card={card}
                      size="md"
                      muted={p.seat === seat && move === undefined && canAct}
                      {...(move ? { onClick: () => play(move) } : {})}
                    />
                  );
                })}
                {p.hand.length === 0 ? <span className="hand__empty">bez kariet</span> : null}
              </div>
            </section>
          );
        })}
      </div>

      <div className="actions">
        {takeMove ? (
          <button type="button" className="btn btn--warn" onClick={() => play(takeMove)}>
            Beriem
          </button>
        ) : null}
        {passMove ? (
          <button type="button" className="btn" onClick={() => play(passMove)}>
            Bito / koniec prihadzovania
          </button>
        ) : null}
        {actors
          .filter((s) => s !== seat)
          .map((s) => (
            <button key={s} type="button" className="btn btn--ghost" onClick={() => setSeat(s)}>
              Prepnúť na {seatName(s)}
            </button>
          ))}
        {actors.length > 1 ? (
          <span className="actions__note">Konať môže viacero hráčov naraz.</span>
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
