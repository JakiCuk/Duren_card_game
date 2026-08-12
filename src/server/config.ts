const int = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`Expected an integer, got ${JSON.stringify(raw)}`);
  return n;
};

export interface ServerConfig {
  host: string;
  port: number;
  /** Directory holding the built client. Absent in dev — Vite serves it. */
  clientDir: string | null;
  maxRooms: number;
  /** How long a room with nobody connected survives before it is closed. */
  roomIdleMs: number;
  /** Override for how long bots pause before moving. Unset means the default. */
  botDelayMs: number | null;
  /** How long a disconnected player's seat is held before a bot takes over. */
  graceMs: number;
  /** How long a present player may think before the server moves for them. 0 = never. */
  turnTimeoutMs: number;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    host: env.HOST ?? '0.0.0.0',
    port: int(env.PORT, 3000),
    clientDir: env.CLIENT_DIR ?? null,
    maxRooms: int(env.MAX_ROOMS, 500),
    roomIdleMs: int(env.ROOM_IDLE_MS, 10 * 60 * 1000),
    botDelayMs: env.BOT_DELAY_MS === undefined ? null : int(env.BOT_DELAY_MS, 0),
    graceMs: int(env.GRACE_MS, 45_000),
    turnTimeoutMs: int(env.TURN_TIMEOUT_MS, 60_000),
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}
