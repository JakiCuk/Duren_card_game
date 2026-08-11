import { useCallback, useMemo, useState } from 'react';
import {
  actorsToAct,
  applyMove,
  createGame,
  ctxOf,
  legalMoves,
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
}

export const defaultSetup = (): LocalGameSetup => ({
  players: 2,
  config: DEFAULT_RULES,
  seed: String(Math.floor(Math.random() * 1_000_000)),
});

interface Snapshot {
  state: GameState;
  events: GameEvent[];
}

/**
 * Hot-seat game driven directly by the engine in the browser.
 *
 * There is no server here on purpose: running the UI against the pure engine
 * first is what proves the engine's API is actually usable, and it does so
 * before any network code exists to blame.
 */
export function useLocalGame(initial: LocalGameSetup = defaultSetup()) {
  const [setup, setSetup] = useState<LocalGameSetup>(initial);
  const [history, setHistory] = useState<Snapshot[]>(() => [start(initial)]);

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

  const undo = useCallback(() => {
    setHistory((past) => (past.length > 1 ? past.slice(0, -1) : past));
  }, []);

  const restart = useCallback((next: LocalGameSetup) => {
    setSetup(next);
    setHistory([start(next)]);
  }, []);

  return {
    setup,
    state,
    events: current.events,
    actors,
    movesFor,
    play,
    undo,
    restart,
    canUndo: history.length > 1,
    moveCount: history.length - 1,
  };
}

function start(setup: LocalGameSetup): Snapshot {
  const { state, events } = createGame({
    players: Array.from({ length: setup.players }, (_, i) => `p${i}`),
    config: setup.config,
    seed: setup.seed,
  });
  return { state, events };
}
