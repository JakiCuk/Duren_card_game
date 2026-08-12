import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  cardCode,
  rankOf,
  suitOf,
  type CardId,
  type GameEvent,
  type Move,
  type PublicEvent,
  type Seat,
} from '../../engine/index.js';
import { CardBackStack, CardFace, stackTopOffset } from '../cards/CardFace.js';
import { useT, type Translate } from '../i18n/index.js';
import type { SortBy } from '../settings/useSettings.js';
import { playedBy, type BoardModel, type BoardSeat } from './model.js';

const EMPTY_EVENTS: readonly (GameEvent | PublicEvent)[] = [];

const SUIT_GLYPH = ['♣', '♦', '♥', '♠'] as const;
const SUIT_KEY = ['suit.clubs', 'suit.diamonds', 'suit.hearts', 'suit.spades'] as const;

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
  /**
   * Everything that has happened, newest last.
   *
   * The board is otherwise handed a position and nothing else, which is enough
   * to draw the table but not to say who put a card on it or where a bout went.
   */
  events?: readonly (GameEvent | PublicEvent)[];
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
  events = EMPTY_EVENTS,
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

  const origins = useMemo(() => playedBy(events), [events]);
  const flight = useFlight(model, chairs, events);
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
                  {/* On the top card, not in the middle of the stack: the pile
                      leans up and to the right as it thickens, and a badge
                      centred on the whole block sits off the card it labels. */}
                  <span
                    className="deck__count"
                    style={{
                      translate: `calc(-50% + ${stackTopOffset(model.deckCount)}px) calc(-50% - ${stackTopOffset(model.deckCount)}px)`,
                    }}
                  >
                    {model.deckCount}
                  </span>
                </span>
              </>
            ) : (
              <span className="deck__empty">{t('board.deckEmpty')}</span>
            )}
            {flight !== null && flight.from === 'deck' ? <FlightLayer flight={flight} /> : null}
          </div>

          <div className="table" aria-label={t('board.table')}>
            {model.table.length === 0 && flight === null ? (
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
                    style={originOf(origins.get(pair.attack) ?? model.attackerSeat, chairs)}
                    {...(pair.defence === null && isDefender ? { onClick: () => setSlot(i) } : {})}
                    title={pair.defence === null ? t('board.unbeatenHint') : cardCode(pair.attack)}
                  />
                  {pair.defence !== null ? (
                    <span
                      className="pair__defence"
                      style={originOf(origins.get(pair.defence) ?? model.defenderSeat, chairs)}
                    >
                      <CardFace card={pair.defence} size="md" />
                    </span>
                  ) : null}
                </div>
              ))
            )}

            {flight !== null && flight.from === 'pile' ? <FlightLayer flight={flight} /> : null}
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

/** One card in mid-air: where it is going, when it starts, and which way up. */
export interface FlyingCard {
  key: string;
  card: CardId;
  /** The side showing when it takes off. */
  faceDown: boolean;
  /** Turns over on the way, e.g. a taken bout going face down into a hand. */
  flips: boolean;
  /** Lands on the table during a hold instead of sitting still on it. */
  enters: boolean;
  delay: number;
  /** Where the card starts inside its layer, and where it is heading. */
  place: CSSProperties;
}

/** A batch of cards doing the same thing at the same moment. */
export interface Flight {
  from: 'pile' | 'deck';
  /** Sitting on the table, scooped into a hand, swept to the discard, or dealt. */
  mode: 'hold' | 'take' | 'bito' | 'deal';
  cards: FlyingCard[];
  /** How long before the next batch may start. */
  duration: number;
}

/*
 * Phase lengths, matched by hand to the CSS animations of the same name.
 *
 * Kept tight on purpose: a bot's pause is the budget. The whole sequence is
 * cancelled the moment the next move arrives, because a flight is a picture of
 * what just happened and showing a stale one would be worse than cutting it.
 */
const HOLD_MS = 560;
const FLY_MS = 620;
const DEAL_MS = 360;
const DEAL_GAP = 80;

/** Pile geometry in rem, mirroring `.pair` and the `.table` gap. */
const PAIR_STEP = 7.5;
const PAIR_GAP = 1.1;
const DEFENCE_DX = 1.1;
const DEFENCE_DY = 1.7;

/** Where a chair sits relative to the middle of the table, in viewport units. */
function deltaTo(seat: Seat, chairs: Map<Seat, CSSProperties>): { x: string; y: string } {
  const chair = chairs.get(seat);
  // No chair means it is your own seat, which the tray draws along the bottom.
  if (chair === undefined) return { x: '0vw', y: '34vh' };
  const left = Number.parseFloat(String(chair.left));
  const top = Number.parseFloat(String(chair.top));
  return { x: `${(left - 50).toFixed(1)}vw`, y: `${((top - 46) * 0.9).toFixed(1)}vh` };
}

const toward = (seat: Seat, chairs: Map<Seat, CSSProperties>): CSSProperties => {
  const { x, y } = deltaTo(seat, chairs);
  return { '--tx': x, '--ty': y } as CSSProperties;
};

/** Which direction a card came from, as an offset the CSS animation starts at. */
function originOf(seat: Seat, chairs: Map<Seat, CSSProperties>): CSSProperties {
  const { x, y } = deltaTo(seat, chairs);
  return { '--fx': x, '--fy': y } as CSSProperties;
}

/** A card is only ever a card; the table is what it lands on. */
type Pile = { attack: CardId; defence: CardId | null }[];

type BoardEvent = GameEvent | PublicEvent;

/**
 * What one move did, read off its events.
 *
 * The board cannot work this out from two positions, and not for want of
 * trying: the engine auto-passes everyone with nothing to throw in and then
 * resolves the bout **inside the same move**. So a bot declaring "I take" while
 * you hold no matching rank never produces a state anybody renders — the take
 * flag goes up and comes down between two frames. Diffing positions therefore
 * reported every such bout as beaten, and lost the last card played entirely.
 */
interface Step {
  /** Cards that reached the table this move, and who put them there. */
  plays: { card: CardId; seat: Seat }[];
  /** The pile as it stood when the bout ended. */
  pile: Pile;
  resolution: { kind: 'take'; seat: Seat } | { kind: 'bito' } | null;
  /** One entry per card dealt, in the order the engine dealt them. */
  deals: { seat: Seat; card: CardId | null }[];
}

export function readStep(before: Pile, events: readonly BoardEvent[]): Step {
  const pile: Pile = before.map((p) => ({ ...p }));
  const plays: { card: CardId; seat: Seat }[] = [];
  const deals: { seat: Seat; card: CardId | null }[] = [];
  let resolution: Step['resolution'] = null;
  let trump: { seat: Seat; card: CardId } | null = null;

  for (const e of events) {
    switch (e.k) {
      case 'attack':
      case 'transfer':
        pile.push({ attack: e.card, defence: null });
        plays.push({ card: e.card, seat: e.seat });
        break;
      case 'defend': {
        const slot = pile[e.slot];
        if (slot) slot.defence = e.card;
        plays.push({ card: e.card, seat: e.seat });
        break;
      }
      case 'take':
        resolution = { kind: 'take', seat: e.seat };
        break;
      case 'bito':
        resolution = { kind: 'bito' };
        break;
      case 'draw': {
        const count = 'count' in e ? e.count : e.cards.length;
        for (let i = 0; i < count; i++) deals.push({ seat: e.seat, card: null });
        break;
      }
      case 'trumpTaken':
        // Emitted alongside the draw that contains it, not instead of it, so it
        // only names the last card rather than adding one.
        trump = { seat: e.seat, card: e.card };
        break;
      default:
        break;
    }
  }

  const last = deals[deals.length - 1];
  if (trump !== null && last !== undefined) last.card = trump.card;

  return { plays, pile, resolution, deals };
}

/**
 * Stages what a move did, in the order a person would see it happen.
 *
 * A card that lands and is swept away in the same move would otherwise never be
 * on screen at all: the bout is one move to the engine, but three things to
 * watch. So the pile is held for a beat first, then it leaves, then the deal
 * that follows it.
 */
export function planFlights(
  before: Pile,
  events: readonly BoardEvent[],
  chairs: Map<Seat, CSSProperties>,
): Flight[] {
  const step = readStep(before, events);
  if (step.resolution === null) return [];

  const phases: Flight[] = [];
  const half = (step.pile.length * PAIR_STEP - PAIR_GAP) / 2;
  const played = new Set(step.plays.map((p) => p.card));
  const origin = new Map(step.plays.map((p) => [p.card, p.seat]));

  /** Every card in the pile, with the spot on the table it is lying on. */
  const laid: { card: CardId; x: number; y: number }[] = [];
  step.pile.forEach((pair, p) => {
    laid.push({ card: pair.attack, x: p * PAIR_STEP - half, y: 0 });
    if (pair.defence !== null) {
      laid.push({ card: pair.defence, x: p * PAIR_STEP - half + DEFENCE_DX, y: DEFENCE_DY });
    }
  });

  const at = (x: number, y: number, extra: CSSProperties = {}): CSSProperties =>
    ({ ...extra, '--x': `${x.toFixed(2)}rem`, '--y': `${y.toFixed(2)}rem` }) as CSSProperties;

  // A card played in the same move that ended the bout has never been drawn on
  // the table, so the pile is held long enough to read before it goes.
  if (step.plays.length > 0) {
    phases.push({
      from: 'pile',
      mode: 'hold',
      duration: HOLD_MS,
      cards: laid.map((c) => ({
        key: `hold-${c.card}`,
        card: c.card,
        faceDown: false,
        flips: false,
        enters: played.has(c.card),
        delay: 0,
        place: at(c.x, c.y, originOf(origin.get(c.card) ?? 0, chairs)),
      })),
    });
  }

  const taken = step.resolution.kind === 'take' ? step.resolution.seat : null;
  const target =
    taken !== null ? toward(taken, chairs) : ({ '--tx': '26vw', '--ty': '-19vh' } as CSSProperties);
  phases.push({
    from: 'pile',
    mode: taken !== null ? 'take' : 'bito',
    duration: FLY_MS,
    cards: laid.map((c) => ({
      key: `pile-${c.card}`,
      card: c.card,
      faceDown: false,
      // Taken cards turn over as they go into a hand; a beaten bout stays face
      // up all the way to the discard, because everyone saw it.
      flips: taken !== null,
      enters: false,
      delay: 0,
      place: at(c.x, c.y, target),
    })),
  });

  if (step.deals.length > 0) {
    phases.push({
      from: 'deck',
      mode: 'deal',
      duration: DEAL_MS + (step.deals.length - 1) * DEAL_GAP,
      cards: step.deals.map((d, i) => ({
        key: `deal-${i}`,
        // The bottom card lies face up under the pile; it turns over as it is
        // dealt, and it is always the very last one out.
        card: d.card ?? 0,
        faceDown: d.card === null,
        flips: d.card !== null,
        enters: false,
        delay: i * DEAL_GAP,
        place: toward(d.seat, chairs),
      })),
    });
  }

  return phases;
}

function useFlight(
  model: BoardModel,
  chairs: Map<Seat, CSSProperties>,
  events: readonly BoardEvent[],
): Flight | null {
  const seen = useRef<number | null>(null);
  const pile = useRef<Pile>([]);
  const latestChairs = useRef(chairs);
  latestChairs.current = chairs;
  const [flight, setFlight] = useState<Flight | null>(null);

  useEffect(() => {
    // A shorter list means a new game, not a rewind of this one.
    if (seen.current === null || events.length < seen.current) {
      seen.current = events.length;
      pile.current = model.table;
      return;
    }
    const fresh = events.slice(seen.current);
    seen.current = events.length;
    const before = pile.current;
    pile.current = model.table;
    if (fresh.length === 0) return;

    const phases = planFlights(before, fresh, latestChairs.current);
    if (phases.length === 0) return;

    let index = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = (): void => {
      const phase = phases[index];
      index++;
      if (phase === undefined) {
        setFlight(null);
        return;
      }
      setFlight(phase);
      timer = setTimeout(next, phase.duration);
    };
    next();
    return () => {
      clearTimeout(timer);
      setFlight(null);
    };
  }, [events, model]);

  return flight;
}

/** The cards currently in mid-air, drawn over whatever they are leaving. */
function FlightLayer({ flight }: { flight: Flight }) {
  return (
    <div className={`flight flight--${flight.from} flight--${flight.mode}`} aria-hidden="true">
      {flight.cards.map((c) => (
        <span
          key={c.key}
          className={`flight__card${c.flips ? ' flight__card--flip' : ''}${c.enters ? ' flight__card--enter' : ''}`}
          style={{ ...c.place, animationDelay: `${c.delay}ms` }}
        >
          <span className="flight__flip">
            <span className="flight__face">
              <CardFace card={c.card} faceDown={c.faceDown} size="md" />
            </span>
            {c.flips ? (
              <span className="flight__face flight__face--back">
                <CardFace card={c.card} faceDown={!c.faceDown} size="md" />
              </span>
            ) : null}
          </span>
        </span>
      ))}
    </div>
  );
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
        <span className="avatar">
          <SeatIcon player={player} model={model} />
        </span>
        <span className="seat__who">
          <span className="seat__name">{player.name}</span>
          <span className="seat__roles">{roles.join(' · ') || t('role.idle')}</span>
        </span>
        {player.team === null ? null : (
          <span className="seat__team">{t('team.name', { n: player.team + 1 })}</span>
        )}
        <span className="seat__count">{t('board.cards', { count: player.handCount })}</span>
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
        <span className="avatar">
          <SeatIcon player={player} model={model} />
        </span>
        <span className="seat__who">
          <span className="seat__name">{player.name}</span>
          <span className="seat__roles">{roles.join(' · ') || t('role.idle')}</span>
        </span>
        {player.team === null ? null : (
          <span className="seat__team">{t('team.name', { n: player.team + 1 })}</span>
        )}
        {showStatus ? (
          // Same two-line shape as the name and its caption beside it: the suit
          // reads as the heading, the word under it as the label.
          <span
            className="seat__trump board__status"
            title={t('board.trumpIs', { suit: t(SUIT_KEY[model.trump]) })}
          >
            <strong className={model.trump === 1 || model.trump === 2 ? 'red' : ''}>
              {SUIT_GLYPH[model.trump]}
            </strong>
            <span>{t('board.trump')}</span>
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
 * What the disc beside a name shows: the job that chair has right now.
 *
 * Initials were there first and said nothing the name beside them did not
 * already say. Crossed swords for the attacker, a single sword for anyone who
 * can still throw one in, a shield for the defender, and nothing at all for a
 * chair with nothing to do. Drawn as SVG rather than emoji: emoji render
 * differently on every system and ignore the text colour.
 */
function SeatIcon({ player, model }: { player: BoardSeat; model: BoardModel }) {
  const t = useT();
  const role = seatRole(player, model);
  if (role === null) return null;

  const label = t(`role.${role === 'throwIn' ? 'canThrowIn' : role === 'shield' ? 'defends' : 'attacks'}`);
  return (
    <svg className="seat__icon" viewBox="0 0 24 24" role="img" aria-label={label} fill="currentColor">
      <title>{label}</title>
      {role === 'shield' ? (
        <path d="M12 2.4 L4.6 5.3 v6.1 c0 4.6 3.1 8.6 7.4 10.2 c4.3-1.6 7.4-5.6 7.4-10.2 V5.3 Z" />
      ) : (
        <>
          <Sword />
          {role === 'sword' ? (
            // The second blade is the first one mirrored, so the two always
            // cross at the same point however the shape is retuned.
            <g transform="translate(24 0) scale(-1 1)">
              <Sword />
            </g>
          ) : null}
        </>
      )}
    </svg>
  );
}

/**
 * One blade, hilt at the bottom left, point at the top right.
 *
 * Filled outlines rather than strokes: the shield beside it is solid, and a
 * stroked sword next to a filled shield reads as two icons from two sets.
 */
const Sword = () => (
  <>
    <path d="M8.9 13.1 L19.3 2.7 L21.3 2.7 L21.3 4.7 L10.9 15.1 Z" />
    <path d="M6.2 12.6 L7.6 11.2 L13 16.6 L11.6 18 Z" />
    <path d="M8.2 14.6 L9.4 15.8 L6.3 18.9 L5.1 17.7 Z" />
    <circle cx="4.4" cy="19.6" r="1.6" />
  </>
);

/**
 * The one job a chair has this instant, or nothing.
 *
 * "Can throw in" is read off `actors`, which is the same approximation the
 * board already draws highlights from: online the client cannot see another
 * player's hand, so it can only say that the seat has not passed and the bout
 * is still open to additions.
 */
function seatRole(p: BoardSeat, model: BoardModel): 'sword' | 'shield' | 'throwIn' | null {
  if (p.out || model.finished) return null;
  if (p.seat === model.defenderSeat) return 'shield';
  if (p.seat === model.attackerSeat) return 'sword';
  if (model.table.length > 0 && !p.passed && model.actors.includes(p.seat)) return 'throwIn';
  return null;
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
