import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildServerWithHub } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';
import type { C2S, S2C } from '../../src/shared/protocol.js';
import { DEFAULT_RULES } from '../../src/shared/rules.js';
import { PROTOCOL_VERSION } from '../../src/shared/version.js';

/**
 * These go through a real socket on a real port. The hub tests already cover
 * the rules; what only a real connection can prove is that frames survive
 * JSON, that a dropped socket is noticed, and that a reconnect finds its seat.
 */
const started: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of started.splice(0)) await stop();
});

async function startServer(): Promise<string> {
  // Bots move instantly here: their pause is a UX feature, not a rule, and
  // waiting for it would make this suite mostly sleep.
  const { app } = await buildServerWithHub(
    loadConfig({ LOG_LEVEL: 'silent', PORT: '0', BOT_DELAY_MS: '1' }),
  );
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  started.push(() => app.close());
  return `ws://127.0.0.1:${address.port}/ws`;
}

class Client {
  private socket: WebSocket;
  readonly received: S2C[] = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (raw: Buffer) => {
      const message = JSON.parse(raw.toString('utf8')) as S2C;
      this.received.push(message);
      for (const wake of this.wakeups.splice(0)) wake();
    });
  }

  static async open(url: string): Promise<Client> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    return new Client(socket);
  }

  send(message: C2S): void {
    this.socket.send(JSON.stringify(message));
  }

  sendRaw(text: string): void {
    this.socket.send(text);
  }

  /** One read position per message kind, so reading views never eats a room.state. */
  private cursors = new Map<string, number>();
  private wakeups: (() => void)[] = [];

  private scan<K extends S2C['t']>(t: K): Extract<S2C, { t: K }> | undefined {
    let at = this.cursors.get(t) ?? 0;
    let last: Extract<S2C, { t: K }> | undefined;
    while (at < this.received.length) {
      const message = this.received[at++]!;
      if (message.t === t) last = message as Extract<S2C, { t: K }>;
    }
    this.cursors.set(t, at);
    return last;
  }

  /**
   * The most recent message of this kind that has not been read yet.
   *
   * "Most recent" rather than "next" on purpose: a real client renders the
   * latest view it has been sent, and acting on an older one would be exactly
   * the stale-sequence mistake the server is designed to reject.
   */
  async latest<K extends S2C['t']>(t: K, timeoutMs = 4000): Promise<Extract<S2C, { t: K }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.scan(t);
      if (found) {
        // Let any burst still in flight land before acting on it.
        await new Promise((r) => setTimeout(r, 5));
        return this.scan(t) ?? found;
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${t}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 25);
        this.wakeups.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  close(): void {
    this.socket.close();
  }

  get closed(): boolean {
    return this.socket.readyState === WebSocket.CLOSED || this.socket.readyState === WebSocket.CLOSING;
  }
}

const hello = (client: Client, token?: string): void =>
  client.send({ t: 'hello', locale: 'sk', protocol: PROTOCOL_VERSION, ...(token ? { token } : {}) });

describe('websocket endpoint', () => {
  it('completes a handshake and mints a token', async () => {
    const url = await startServer();
    const client = await Client.open(url);
    hello(client);

    const ok = await client.latest('hello.ok');
    expect(ok.protocol).toBe(PROTOCOL_VERSION);
    expect(ok.token).toHaveLength(32);
    expect(ok.room).toBeNull();
  });

  it('refuses a client speaking a different protocol version', async () => {
    const url = await startServer();
    const client = await Client.open(url);
    client.send({ t: 'hello', locale: 'sk', protocol: PROTOCOL_VERSION + 99 });
    expect((await client.latest('error')).code).toBe('protocol_mismatch');
  });

  it('rejects junk without dropping the connection', async () => {
    const url = await startServer();
    const client = await Client.open(url);
    client.sendRaw('this is not json');
    expect((await client.latest('error')).code).toBe('bad_message');

    // Still alive: a handshake now works.
    hello(client);
    expect((await client.latest('hello.ok')).token).toBeTruthy();
  });

  it('insists on a handshake before anything else', async () => {
    const url = await startServer();
    const client = await Client.open(url);
    client.send({ t: 'ping' });
    expect((await client.latest('error')).detail).toContain('hello');
  });

  it('carries a two-player game between two real sockets', async () => {
    const url = await startServer();
    const host = await Client.open(url);
    const guest = await Client.open(url);
    hello(host);
    hello(guest);
    await host.latest('hello.ok');
    await guest.latest('hello.ok');

    host.send({ t: 'room.create', name: 'Roman', config: DEFAULT_RULES });
    const code = (await host.latest('room.state')).room.code;

    guest.send({ t: 'room.join', code, name: 'Katka' });
    const joined = await guest.latest('room.state');
    expect(joined.you).toBe(1);

    host.send({ t: 'room.start' });
    const hostView = (await host.latest('game.view')).view;
    const guestView = (await guest.latest('game.view')).view;

    expect(hostView.you?.seat).toBe(0);
    expect(guestView.you?.seat).toBe(1);
    expect(hostView.you?.hand).toHaveLength(6);
    // Neither player receives the other's cards.
    expect(JSON.stringify(hostView)).not.toContain(JSON.stringify(guestView.you?.hand));

    // Play one real move and watch it reach the other player.
    const attacker = hostView.legalMoves.length > 0 ? host : guest;
    const view = hostView.legalMoves.length > 0 ? hostView : guestView;
    const other = attacker === host ? guest : host;
    attacker.send({ t: 'game.move', seq: view.seq, move: view.legalMoves[0]! });

    const echoed = await other.latest('game.view');
    expect(echoed.view.table.length).toBeGreaterThan(0);
    expect(echoed.events.some((e) => e.k === 'attack')).toBe(true);
  });

  it('gives a reconnecting player their seat and hand back', async () => {
    const url = await startServer();
    const host = await Client.open(url);
    hello(host);
    const token = (await host.latest('hello.ok')).token;

    host.send({ t: 'room.create', name: 'Roman', config: DEFAULT_RULES });
    await host.latest('room.state');
    host.send({ t: 'room.bot.add', seat: 1, level: 1 });
    host.send({ t: 'room.start' });
    const before = (await host.latest('game.view')).view;

    host.close();
    await new Promise((r) => setTimeout(r, 50));

    const revived = await Client.open(url);
    hello(revived, token);
    const restored = await revived.latest('game.view');
    expect(restored.view.you?.seat).toBe(before.you?.seat);
    expect(restored.view.you?.hand).toEqual(before.you?.hand);
    expect((await revived.latest('hello.ok')).room?.phase).toBe('playing');
  });

  it('hands the seat to the newest tab and closes the old socket', async () => {
    const url = await startServer();
    const first = await Client.open(url);
    hello(first);
    const token = (await first.latest('hello.ok')).token;

    const second = await Client.open(url);
    hello(second, token);
    await second.latest('hello.ok');

    await new Promise((r) => setTimeout(r, 100));
    expect(first.closed).toBe(true);
  });

  it('plays a full game against a bot over the socket', async () => {
    const url = await startServer();
    const client = await Client.open(url);
    hello(client);
    await client.latest('hello.ok');

    client.send({ t: 'room.create', name: 'Roman', config: DEFAULT_RULES });
    await client.latest('room.state');
    client.send({ t: 'room.bot.add', seat: 1, level: 2 });
    client.send({ t: 'room.start' });

    let view = (await client.latest('game.view')).view;
    for (let step = 0; step < 300 && !view.finished; step++) {
      const move = view.legalMoves[0];
      // With no legal move the only thing to do is wait for the bot's turn.
      if (move) client.send({ t: 'game.move', seq: view.seq, move });
      view = (await client.latest('game.view', 3000)).view;
    }

    expect(view.finished).toBe(true);
    expect(view.result).not.toBeNull();

    // `stale_seq` is the server working, not failing: with an instant bot the
    // client can act on a view that was superseded in the same tick. A real
    // client re-renders and tries again — which the loop above does implicitly.
    // Anything else would be a genuine protocol violation.
    const unexpected = client.received.filter((m) => m.t === 'error' && m.code !== 'stale_seq');
    expect(unexpected).toEqual([]);
  }, 30_000);
});
