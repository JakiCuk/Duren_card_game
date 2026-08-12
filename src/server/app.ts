import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION } from '../shared/version.js';
import type { ServerConfig } from './config.js';
import { Hub } from './hub.js';
import { registerWebsocket } from './ws.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Where the built client lives, or null when it has not been built. In dev the
 * Vite server owns the UI and proxies /ws and /api here, so a missing bundle is
 * normal rather than an error.
 */
function resolveClientDir(config: ServerConfig): string | null {
  const candidate = config.clientDir ?? resolve(here, '../../client');
  return existsSync(resolve(candidate, 'index.html')) ? candidate : null;
}

export interface BuiltServer {
  app: FastifyInstance;
  hub: Hub;
}

export async function buildServer(config: ServerConfig): Promise<FastifyInstance> {
  return (await buildServerWithHub(config)).app;
}

export async function buildServerWithHub(config: ServerConfig): Promise<BuiltServer> {
  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: true,
  });

  const hub = new Hub({
    maxRooms: config.maxRooms,
    policy: {
      graceMs: config.graceMs,
      turnTimeoutMs: config.turnTimeoutMs > 0 ? config.turnTimeoutMs : null,
    },
    ...(config.botDelayMs === null ? {} : { botDelayMs: config.botDelayMs }),
  });
  await registerWebsocket(app, hub);

  app.get('/healthz', () => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    uptime: Math.round(process.uptime()),
    rooms: hub.rooms.size,
  }));

  // Rooms nobody is connected to are swept periodically; the interval is
  // unref'd so it never holds the process open on shutdown.
  const sweeper = setInterval(() => {
    const closed = hub.sweep(config.roomIdleMs);
    if (closed > 0) app.log.info({ closed }, 'swept idle rooms');
  }, 60_000);
  if (typeof sweeper.unref === 'function') sweeper.unref();
  app.addHook('onClose', () => {
    clearInterval(sweeper);
  });

  const clientDir = resolveClientDir(config);
  if (clientDir) {
    await app.register(fastifyStatic, { root: clientDir, index: ['index.html'] });
    // The client routes on the hash fragment, so any unknown GET is still the SPA.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not_found' });
    });
  } else {
    app.log.warn('No client build found — serving API only (expected in dev).');
  }

  return { app, hub };
}
