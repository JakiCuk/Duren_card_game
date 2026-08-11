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
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    host: env.HOST ?? '0.0.0.0',
    port: int(env.PORT, 3000),
    clientDir: env.CLIENT_DIR ?? null,
    maxRooms: int(env.MAX_ROOMS, 500),
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}
