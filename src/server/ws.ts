import fastifyWebsocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { c2sSchema, type S2C } from '../shared/protocol.js';
import { PROTOCOL_VERSION } from '../shared/version.js';
import type { Hub, Sink } from './hub.js';
import { RoomError } from './rooms.js';
import type { Session } from './sessions.js';

const HEARTBEAT_MS = 20_000;

class SocketSink implements Sink {
  constructor(private readonly socket: WebSocket) {}

  send(message: S2C): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket.close(4000, 'replaced');
  }
}

/**
 * The socket endpoint.
 *
 * It owns exactly two things the hub does not: parsing bytes into JSON, and
 * knowing when a peer has gone quiet. Everything else — identity, rooms, rules
 * — lives behind `Hub`, which is what makes the whole thing testable without a
 * network.
 */
export async function registerWebsocket(app: FastifyInstance, hub: Hub): Promise<void> {
  await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });

  app.get('/ws', { websocket: true }, (socket) => {
    const sink = new SocketSink(socket);
    let session: Session | null = null;
    let alive = true;

    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, HEARTBEAT_MS);
    if (typeof heartbeat.unref === 'function') heartbeat.unref();

    socket.on('pong', () => {
      alive = true;
    });

    socket.on('message', (raw: Buffer) => {
      alive = true;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString('utf8'));
      } catch {
        sink.send({ t: 'error', code: 'bad_message', detail: 'not json' });
        return;
      }

      const message = c2sSchema.safeParse(parsed);
      if (!message.success) {
        sink.send({ t: 'error', code: 'bad_message', detail: message.error.issues[0]?.message ?? '' });
        return;
      }

      if (message.data.t === 'hello') {
        if (message.data.protocol !== PROTOCOL_VERSION) {
          sink.send({ t: 'error', code: 'protocol_mismatch', detail: String(PROTOCOL_VERSION) });
          socket.close(4001, 'protocol');
          return;
        }
        session = hub.sessions.hello(message.data.token, 'Hráč');
        hub.attach(sink, session);
        hub.helloResponse(sink, session);
        return;
      }

      if (session === null) {
        sink.send({ t: 'error', code: 'bad_message', detail: 'say hello first' });
        return;
      }

      const conn = hub.connectionFor(session.playerId);
      if (!conn || conn.sink !== sink) {
        // A newer tab took this session over; this socket is a ghost.
        sink.send({ t: 'error', code: 'bad_message', detail: 'session moved' });
        return;
      }

      try {
        hub.handleFrom(conn, message.data);
      } catch (err) {
        if (err instanceof RoomError) {
          sink.send({ t: 'error', code: err.code });
          return;
        }
        app.log.error({ err }, 'websocket handler failed');
        sink.send({ t: 'error', code: 'bad_message', detail: 'server error' });
      }
    });

    socket.on('close', () => {
      clearInterval(heartbeat);
      if (session) hub.disconnect(session.playerId, sink);
    });
  });
}
