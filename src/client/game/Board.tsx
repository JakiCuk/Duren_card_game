import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  cardCode,
  rankOf,
  suitOf,
  type CardId,
  type Move,
  type Seat,
  type TableSlot,
} from '../../engine/index.js';
import { CardBackStack, CardFace } from '../cards/CardFace.js';
import { useT, type Translate } from '../i18n/index.js';
import type { SortBy } from '../settings/useSettings.js';
import type { BoardModel, BoardSeat } from './model.js';

const SUIT_GLYPH = ['♣', '♦', '♥', '♠'] as const;
const SUIT_KEY = ['suit.clubs', 'suit.diamonds', 'suit.hearts', 'suit.spades'] as const;

/** How long a bout stays on screen flying away after it is over. */
const FLIGHT_MS = 520;

export interface BoardProps {
  model: BoardModel;
  play: (move: Move) => void;
  /** True while this player could still add a card, so the table can say so. */
  awaitingThrowIn?: boolean;
  /** Show the trump beside your name. */
  showStatus?: boolean;
  /** Suits grouped, or one run from weakest to strongest. */
  sortBy?: SortBy;
  /** Dim the cards you may not play. Off, the hand is drawn plain. */
  hints?: boolean;
}

/**
 * A round table seen from your own chair.
 *
 * Everything sits where it would if you pulled up a seat: your hand fanned
 * along the bottom edge, the other players around the far side, the draw pile
 * beside the cards in play, and the buttons that act on them directly
 * underneath. Whoever you are playing rotates to the bottom, so the layout
 * never asks you to work out which of six chairs is yours.
 */
export function Board({
  model,
  play,
  awaitingThrowIn = false,
  showStatus = true,
  sortBy = 'suit',
  hints = true,
}: BoardProps) {
  const t = useT();
  const [seat, setSeat] = useState<Seat>(model.mySeat ?? model.controllable[0] ?? 0);
  const [slot, setSlot] = useState(0);

  const firstUnbeaten = model.table.findIndex((x) => x.defence === null);

  useEffect(() => {
    // Online, the chair is yours and never moves. Hot seat has no fixed owner,
    // so the table follows whoever can act.
    if (model.mySeat !== null) {
      if (seat !== model.mySeat) setSeat(model.mySeat);
      return;
    }
    if (model.controllable.length > 0 && !model.controllable.includes(seat)) {
      setSeat(model.controllable[0]!);
    }
  }, [model.mySeat, model.controllable, seat]);
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

  const chairs = useMemo(() => {
    const map = new Map<Seat, CSSProperties>();
    others.forEach((p, i) => map.set(p.seat, seatPosition(i, others.length + 1)));
    return map;
  }, [model.seats, meIndex]);

  const flight = useFlight(model);
  const prompt = awaitingThrowIn
    ? t('board.yourThrowIn')
    : model.controllable.length === 0 && !model.finished
      ? t('board.waiting')
      : null;

  return (
    <div className="board">
      <div className="felt" />

      {others.map((p) => (
        <Opponent key={p.seat} player={p} model={model} style={chairs.get(p.seat)!} />
      ))}

      <div className="felt__centre">
        <div className="felt__pile">
          <div className="felt__deck">
            {model.deckCount > 0 ? (
              <>
                {model.trumpCard !== null ? (
                  <span className="deck__trump">
                    <CardFace card={model.trumpCard} size="md" title={t('board.trumpCard')} />
                  </span>
                ) : null}
                <span className="deck__pile">
                  <CardBackStack count={model.deckCount} size="md" />
                  <span className="deck__count">{model.deckCount}</span>
                </span>
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
                    style={originOf(model.attackerSeat, chairs)}
                    {...(pair.defence === null && isDefender ? { onClick: () => setSlot(i) } : {})}
                    title={pair.defence === null ? t('board.unbeatenHint') : cardCode(pair.attack)}
                  />
                  {pair.defence !== null ? (
                    <span className="pair__defence" style={originOf(model.defenderSeat, chairs)}>
                      <CardFace card={pair.defence} size="md" />
                    </span>
                  ) : null}
                </div>
              ))
            )}

            {flight === null ? null : (
              <div className="flight" aria-hidden="true" style={flight.target}>
                {flight.cards.map((card, i) => (
                  <span key={`${card}-${i}`} className="flight__card">
                    <CardFace card={card} size="md" />
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="tray">
        {prompt === null ? null : (
          <p className={`felt__prompt${awaitingThrowIn ? ' felt__prompt--wait' : ''}`}>{prompt}</p>
        )}

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

        <Me
          player={me}
          model={model}
          playable={playableCards}
          play={play}
          sortBy={sortBy}
          hints={hints}
          showStatus={showStatus}
        />
      </div>
    </div>
  );
}

/**
 * Keeps a bout on screen for half a second after it leaves the table, flying
 * towards wherever it went.
 *
 * Cards vanishing between two renders is the one moment where the board stops
 * telling you what happened — you look up and six cards are simply gone, with
 * no way to tell whether the defender took them or they went to the discard.
 */
function useFlight(model: BoardModel): { cards: CardId[]; target: CSSProperties } | null {
  const previous = useRef<{ table: TableSlot[]; taking: boolean } | null>(null);
  const [flight, setFlight] = useState<{ cards: CardId[]; target: CSSProperties } | null>(null);

  useEffect(() => {
    const before = previous.current;
    previous.current = { table: model.table, taking: model.defenderTaking };
    if (before === null || before.table.length === 0 || model.table.length > 0) return;

    const cards = before.table.flatMap((p) => (p.defence === null ? [p.attack] : [p.attack, p.defence]));
    // Taken cards go to the defender's chair; beaten ones go to the discard,
    // which lives off to the right of the pile.
    setFlight({
      cards,
      target: (before.taking
        ? { '--tx': '0vw', '--ty': '34vh' }
        : { '--tx': '22vw', '--ty': '-4vh' }) as CSSProperties,
    });
    const timer = setTimeout(() => setFlight(null), FLIGHT_MS);
    return () => clearTimeout(timer);
  }, [model.table, model.defenderTaking]);

  return flight;
}

/**
 * Which direction a card came from, as an offset the CSS animation starts at.
 *
 * Attacks fly in from the attacker's chair and defences from the defender's.
 * A card thrown in by a third player therefore arrives from the wrong chair —
 * the board is given a position, not a move log, and guessing the thrower from
 * the pile alone would be a guess.
 */
function originOf(seat: Seat, chairs: Map<Seat, CSSProperties>): CSSProperties {
  const chair = chairs.get(seat);
  if (chair === undefined) return { '--fx': '0vw', '--fy': '34vh' } as CSSProperties;
  const left = Number.parseFloat(String(chair.left));
  const top = Number.parseFloat(String(chair.top));
  return {
    '--fx': `${(left - 50).toFixed(1)}vw`,
    '--fy': `${((top - 46) * 0.9).toFixed(1)}vh`,
  } as CSSProperties;
}

/** Somebody sitting across the table: a name chip and a small fan of backs. */
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
  const roles = roleLabels(player, model, t);
  return (
    <section
      aria-label={player.name}
      className={`seat seat--across${roleClasses(player, model)}`}
      style={style}
    >
      <header className="seat__head">
        <span className="avatar">{initials(player.name)}</span>
        <span className="seat__who">
          <span className="seat__name">{player.name}</span>
          <span className="seat__roles">{roles.join(' · ') || t('role.idle')}</span>
        </span>
        {player.team === null ? null : (
          <span className="seat__team">{t('team.name', { n: player.team + 1 })}</span>
        )}
        <span className="seat__count">{player.handCount}</span>
      </header>

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

/**
 * The near edge of the table: one name row and your hand, fanned and clickable.
 *
 * One row, not two. The chair and the turn indicator used to be separate
 * strips that said the same thing twice — your name, your role and your card
 * count, printed above each other.
 */
function Me({
  player,
  model,
  playable,
  play,
  sortBy,
  hints,
  showStatus,
}: {
  player: BoardSeat;
  model: BoardModel;
  playable: Map<CardId, Move>;
  play: (move: Move) => void;
  sortBy: SortBy;
  hints: boolean;
  showStatus: boolean;
}) {
  const t = useT();
  const canAct = model.actors.includes(player.seat);
  const hand = player.hand === null ? null : sortForDisplay(player.hand, model.trump, sortBy);
  const count = hand?.length ?? player.handCount;
  const roles = roleLabels(player, model, t);

  return (
    <section
      aria-label={player.name}
      className={`seat seat--me${roleClasses(player, model)}${canAct ? ' seat--turn' : ''}`}
    >
      <header className="seat__head">
        <span className="turn__avatar">{initials(player.name)}</span>
        <span className="seat__who">
          <span className="seat__name">{player.name}</span>
          <span className="seat__roles">{roles.join(' · ') || t('role.idle')}</span>
        </span>
        {player.team === null ? null : (
          <span className="seat__team">{t('team.name', { n: player.team + 1 })}</span>
        )}
        {showStatus ? (
          <span
            className="chip board__status"
            title={t('board.trumpIs', { suit: t(SUIT_KEY[model.trump]) })}
          >
            {t('board.trump')}{' '}
            <strong className={model.trump === 1 || model.trump === 2 ? 'red' : ''}>
              {SUIT_GLYPH[model.trump]}
            </strong>
          </span>
        ) : null}
        <span className="seat__count">{t('board.cards', { count: player.handCount })}</span>
      </header>

      <div className="hand">
        {hand === null
          ? Array.from({ length: player.handCount }, (_, i) => (
              <CardFace key={i} card={0} faceDown size="lg" style={fan(i, count)} />
            ))
          : hand.map((cardId, i) => {
              const move = playable.get(cardId);
              return (
                <CardFace
                  key={cardId}
                  card={cardId}
                  size="lg"
                  style={fan(i, count)}
                  muted={hints && move === undefined && canAct}
                  {...(move ? { onClick: () => play(move) } : {})}
                />
              );
            })}
        {player.handCount === 0 ? <span className="hand__empty">{t('board.noCards')}</span> : null}
      </div>
    </section>
  );
}

/**
 * A hand held in one hand: cards splay outwards and dip at the edges.
 *
 * The rotation is what makes an overlapping row read as a fan rather than as a
 * stack — without it the cards look shuffled together and you cannot tell where
 * one ends.
 */
function fan(index: number, count: number): CSSProperties {
  const off = index - (count - 1) / 2;
  return { transform: `translateY(${off * off * 2}px) rotate(${off * 5}deg)`, zIndex: index };
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

/**
 * Two letters for the avatar disc: initials when the name has words to take
 * them from, otherwise the first two characters.
 */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return (words[0] ?? '?').slice(0, 2).toUpperCase();
}

/**
 * Chairs around an ellipse, yours at the bottom.
 *
 * `total` counts you as well, so the angles divide the whole table and the
 * remaining players are spread evenly across the other side however many of
 * them there are. Your own seat, index `total - 1`, lands at the bottom — which
 * is where the tray draws it instead.
 */
function seatPosition(index: number, total: number): CSSProperties {
  const angle = ((-90 + (index + 1) * (360 / total)) * Math.PI) / 180;
  return {
    left: `${50 + 38 * Math.cos(angle)}%`,
    top: `${45 - 30 * Math.sin(angle)}%`,
  };
}

const rotate = <T,>(items: readonly T[], by: number): T[] => [
  ...items.slice(by),
  ...items.slice(0, by),
];

/**
 * Display order only. The engine keeps hands in card-id order for hashing; how
 * they look is a client decision.
 *
 * `suit` groups the suits and puts trumps last, which is how most people hold a
 * hand. `power` is one run from the card that beats least to the card that
 * beats most, which is what you want when the question is "what can I still
 * stop?".
 */
function sortForDisplay(hand: readonly CardId[], trump: number, sortBy: SortBy): CardId[] {
  const power = (c: CardId): number => rankOf(c) + (suitOf(c) === trump ? 100 : 0);
  return [...hand].sort((a, b) => {
    if (sortBy === 'power') return power(a) - power(b);
    const at = suitOf(a) === trump ? 1 : 0;
    const bt = suitOf(b) === trump ? 1 : 0;
    if (at !== bt) return at - bt;
    if (suitOf(a) !== suitOf(b)) return suitOf(a) - suitOf(b);
    return rankOf(a) - rankOf(b);
  });
}
