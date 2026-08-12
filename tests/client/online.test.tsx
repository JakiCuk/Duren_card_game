// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket as NodeWebSocket } from 'ws';
import { buildServerWithHub } from '../../src/server/app.js';
import { loadConfig } from '../../src/server/config.js';
import { renderApp } from './render.js';

/**
 * The online client against a real server.
 *
 * jsdom has no WebSocket, so the browser global is pointed at the `ws` package
 * and `window.location.host` at the real port. Everything above that — the
 * hook, the lobby, the board — is the code that ships.
 */
let port = 0;
const stops: (() => Promise<void>)[] = [];

beforeAll(async () => {
  const { app } = await buildServerWithHub(
    loadConfig({ LOG_LEVEL: 'silent', PORT: '0', BOT_DELAY_MS: '1' }),
  );
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  port = address.port;
  stops.push(() => app.close());

  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, protocol: 'http:', host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` },
  });
  // @ts-expect-error jsdom has no WebSocket; the ws implementation is close enough.
  globalThis.WebSocket = NodeWebSocket;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// One server for the whole file: starting and stopping it per test would race
// with the client's automatic reconnect.
afterAll(async () => {
  for (const stop of stops.splice(0)) await stop();
});

const goOnline = async (user: ReturnType<typeof userEvent.setup>) => {
  renderApp();
  await user.click(screen.getByRole('button', { name: 'Online izba' }));
  await screen.findByText('pripojené', {}, { timeout: 5000 });
};

/**
 * The room code, which the lobby prints twice — once in the kicker above the
 * heading and once in the table facts. Either one proves the room exists.
 */
const roomCode = async (): Promise<string> => {
  const found = await screen.findAllByText(/^[0-9A-HJ-NP-TV-Z]{5}$/, {}, { timeout: 5000 });
  return found[0]!.textContent ?? '';
};

describe('online room', () => {
  it('connects to the server on demand', async () => {
    const user = userEvent.setup();
    await goOnline(user);
    expect(screen.getByRole('button', { name: 'Vytvoriť izbu' }).hasAttribute('disabled')).toBe(false);
  });

  it('creates a room and shows a shareable code', async () => {
    const user = userEvent.setup();
    await goOnline(user);

    await user.click(screen.getByRole('button', { name: 'Vytvoriť izbu' }));
    expect(await roomCode()).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Kopírovať odkaz' })).toBeTruthy();
    // Six chairs, the host already sitting in one.
    expect(screen.getAllByText('Voľné miesto')).toHaveLength(5);
  });

  it('says so when the code does not exist', async () => {
    const user = userEvent.setup();
    await goOnline(user);

    await user.type(screen.getByLabelText('Kód izby'), 'ZZZZZ');
    await user.click(screen.getByRole('button', { name: 'Pripojiť sa' }));
    const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(alert.textContent).toMatch(/neexistuje/);
  });

  it('will not start a game with nobody to play against', async () => {
    const user = userEvent.setup();
    await goOnline(user);
    await user.click(screen.getByRole('button', { name: 'Vytvoriť izbu' }));
    await roomCode();

    expect(screen.getByRole('button', { name: 'Začať hru' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/aspoň dvoch/)).toBeTruthy();
  });

  it('adds a bot, starts, and deals a hand only this player can see', async () => {
    const user = userEvent.setup();
    await goOnline(user);
    await user.click(screen.getByRole('button', { name: 'Vytvoriť izbu' }));
    await roomCode();

    const seats = screen.getAllByRole('listitem');
    await user.click(within(seats[1]!).getAllByRole('button', { name: /^\+ Pokročilý$/ })[0]!);

    const start = await screen.findByRole('button', { name: 'Začať hru' });
    await waitFor(() => expect(start.hasAttribute('disabled')).toBe(false));
    await user.click(start);

    // The board replaces the lobby once the deal arrives.
    await screen.findByLabelText('Stôl', {}, { timeout: 5000 });
    const mine = document.querySelectorAll('.seat--me .hand .card img');
    expect(mine.length).toBe(6);

    // The opponent is a bot and its cards are backs, never codes.
    const faceUp = Array.from(document.querySelectorAll('.seat .hand .card img')).filter(
      (img) => img.getAttribute('alt') !== 'Rubová strana',
    );
    expect(faceUp).toHaveLength(6);
  }, 20_000);

  it('plays a move that the server accepts and echoes back', async () => {
    const user = userEvent.setup();
    await goOnline(user);
    await user.click(screen.getByRole('button', { name: 'Vytvoriť izbu' }));
    await roomCode();

    const seats = screen.getAllByRole('listitem');
    await user.click(within(seats[1]!).getAllByRole('button', { name: /^\+ Začiatočník$/ })[0]!);
    const start = await screen.findByRole('button', { name: 'Začať hru' });
    await waitFor(() => expect(start.hasAttribute('disabled')).toBe(false));
    await user.click(start);
    await screen.findByLabelText('Stôl', {}, { timeout: 5000 });

    // Wait until this player has something to do, then do it.
    await waitFor(
      () => {
        const playable = document.querySelectorAll(
          '.seat--me .hand button.card:not(.card--muted)',
        );
        expect(playable.length).toBeGreaterThan(0);
      },
      { timeout: 6000 },
    );

    // The log, not the table: with an instant bot the bout can be beaten and
    // swept before the assertion runs, leaving the table empty again. The log
    // records that the move happened either way.
    const before = document.querySelectorAll('.log li').length;
    await user.click(
      document.querySelector<HTMLElement>('.seat--me .hand button.card:not(.card--muted)')!,
    );

    await waitFor(
      () => {
        expect(document.querySelectorAll('.log li').length).toBeGreaterThan(before);
      },
      { timeout: 6000 },
    );
    // The server never complained.
    expect(screen.queryByRole('alert')).toBeNull();
  }, 25_000);
});
