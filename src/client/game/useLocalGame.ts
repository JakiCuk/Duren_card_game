import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBot, type BotLevel, type BotPolicy } from '../../bots/index.js';
import {
  actorsToAct,
  applyMove,
  createGame,
  ctxOf,
  legalMoves,
  redact,
  redactEvents,
  type GameEvent,
  type GameState,
  type Move,
  type Seat,
} from '../../engine/index.js';
import { DEFAULT_RULES, type RuleConfig } from '../../shared/rules.js';

export interface LocalGameSetup {
  players: number;
  config: RuleConfig;
  seed: string;
  /** One entry per seat; `null` means a human sits there. */
  bots: (BotLevel | null)[];
}

export const defaultSetup = (): LocalGameSetup => ({
  players: 2,
  config: DEFAULT_RULES,
  seed: String(Math.floor(Math.random() * 1_000_000)),
  bots: [null, 2],
});

/**
 * How long a bot waits before playing.
 *
 * The player's setting is the whole budget; stronger levels are given a little
 * more of it so the pause reads as thinking rather than lag.
 */
const thinkingMs = (level: BotLevel, budget: number): number =>
  budget <= 0 ? 0 : Math.round(budget * (0.6 + level * 0.1));

interface Snapshot {
  state: GameState;
  events: GameEvent[];
}

/**
 * Hot-seat and versus-bot game driven directly by the engine in the browser.
 *
 * No server involved on purpose: running the UI against the pure engine first
 * is what proves the engine's API is usable, and it does so before there is any
 * network code to blame.
 */
export interface LocalGameOptions {
  botDelayMs: number;
  /** Freeze the bots while a human still has a card they could throw in. */
  holdForThrowIn: boolean;
}

export function useLocalGame(
  initial: LocalGameSetup = defaultSetup(),
  options: LocalGameOptions = { botDelayMs: 900, holdForThrowIn: true },
) {
  const [setup, setSetup] = useState<LocalGameSetup>(initial);
  const [history, setHistory] = useState<Snapshot[]>(() => [start(initial)]);
  const bots = useRef<Map<Seat, BotPolicy>>(new Map());
  const delivered = useRef(0);

  // Bot instances belong to a game, not to a render. Rebuilt on restart only.
  if (bots.current.size === 0 && setup.bots.some((b) => b !== null)) {
    bots.current = makeBots(setup);
  }

  const current = history[history.length - 1]!;
  const { state } = current;
  const actors = useMemo(() => actorsToAct(state), [state]);

  const movesFor = useCallback(
    (seat: Seat): Move[] => (state.phase === 'bout' ? legalMoves(ctxOf(state), seat) : []),
    [state],
  );

  const play = useCallback((move: Move) => {
    setHistory((past) => {
      const from = past[past.length - 1]!;
      const next = applyMove(from.state, move);
      return [...past, { state: next.state, events: [...from.events, ...next.events] }];
    });
  }, []);

  const restart = useCallback((next: LocalGameSetup) => {
    bots.current = makeBots(next);
    delivered.current = 0;
    setSetup(next);
    setHistory([start(next)]);
  }, []);

  const undo = useCallback(() => {
    setHistory((past) => (past.length > 1 ? past.slice(0, -1) : past));
  }, []);

  // Feed each bot the public events it has not seen. Undo rewinds the counter,
  // so a rewound game does not replay stale observations.
  useEffect(() => {
    const fresh = current.events.slice(Math.min(delivered.current, current.events.length));
    delivered.current = current.events.length;
    if (fresh.length === 0) return;
    for (const [seat, bot] of bots.current) bot.observe(redactEvents(fresh, seat));
  }, [current.events]);

  const isBot = useCallback((seat: Seat) => bots.current.has(seat), []);

  /**
   * A human seat that could add a card to the pile right now.
   *
   * "Could throw in" means an attack onto a table that already has cards — the
   * opening attack is compulsory and nobody needs protecting from it.
   */
  const pendingThrowIn = useMemo(() => {
    if (state.phase !== 'bout' || state.table.length === 0) return null;
    const ctx = ctxOf(state);
    for (const seat of actors) {
      if (bots.current.has(seat)) continue;
      if (legalMoves(ctx, seat).some((m) => m.t === 'ATTACK')) return seat;
    }
    return null;
  }, [state, actors]);

  // One bot move per tick, so the table animates rather than jumping.
  useEffect(() => {
    if (state.phase !== 'bout') return;
    // Hold everything while the player still has a card they could add: a bot
    // piling on first would take the decision away before they saw it.
    if (options.holdForThrowIn && pendingThrowIn !== null) return;

    const seat = actors.find((s) => bots.current.has(s));
    if (seat === undefined) return;

    const bot = bots.current.get(seat)!;
    const timer = setTimeout(
      () => play(bot.chooseMove(redact(state, seat))),
      thinkingMs(bot.level, options.botDelayMs),
    );
    return () => clearTimeout(timer);
  }, [state, actors, play, options.botDelayMs, options.holdForThrowIn, pendingThrowIn]);

  return {
    setup,
    state,
    events: current.events,
    actors,
    movesFor,
    play,
    undo,
    restart,
    isBot,
    /** Set while a human could still throw in, so the UI can say so. */
    pendingThrowIn,
    /** Seats a human may act for — bots are not clickable. */
    humanActors: actors.filter((s) => !bots.current.has(s)),
    canUndo: history.length > 1,
    moveCount: history.length - 1,
  };
}

function makeBots(setup: LocalGameSetup): Map<Seat, BotPolicy> {
  const map = new Map<Seat, BotPolicy>();
  setup.bots.slice(0, setup.players).forEach((level, seat) => {
    if (level !== null) map.set(seat, createBot(level, seat, `${setup.seed}:${seat}`));
  });
  return map;
}

function start(setup: LocalGameSetup): Snapshot {
  const { state, events } = createGame({
    players: Array.from({ length: setup.players }, (_, i) => `p${i}`),
    config: setup.config,
    seed: setup.seed,
  });
  return { state, events };
}
