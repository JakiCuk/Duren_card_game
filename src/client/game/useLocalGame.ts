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

/** Bots pause before moving so the table stays readable. */
const thinkingMs = (level: BotLevel): number => 350 + level * 150;

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
export function useLocalGame(initial: LocalGameSetup = defaultSetup()) {
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

  // One bot move per tick, so the table animates rather than jumping.
  useEffect(() => {
    if (state.phase !== 'bout') return;
    const seat = actors.find((s) => bots.current.has(s));
    if (seat === undefined) return;

    const bot = bots.current.get(seat)!;
    const timer = setTimeout(() => play(bot.chooseMove(redact(state, seat))), thinkingMs(bot.level));
    return () => clearTimeout(timer);
  }, [state, actors, play]);

  const isBot = useCallback((seat: Seat) => bots.current.has(seat), []);

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
