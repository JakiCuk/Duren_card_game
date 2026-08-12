// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useOnline } from '../../src/client/net/useOnline.js';
import { DEFAULT_RULES } from '../../src/shared/rules.js';

/**
 * A socket whose events fire only when a test says so.
 *
 * The real ordering bug this file exists for depends on an old socket's close
 * arriving *after* its replacement is installed. Neither jsdom nor a real
 * server reproduces that on demand, so the events have to be driven by hand.
 */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = FakeSocket.CONNECTING;
  readonly sent: string[] = [];
  closeCalled = false;

  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalled = true;
  }

  /** The handshake the client performs on connect. */
  open(): void {
    this.readyState = FakeSocket.OPEN;
    act(() => this.onopen?.());
  }

  fireClose(): void {
    this.readyState = FakeSocket.CLOSED;
    act(() => this.onclose?.());
  }

  frames(): { t: string }[] {
    return this.sent.map((s) => JSON.parse(s) as { t: string });
  }
}

const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

describe('the online socket', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    // @ts-expect-error the stub only implements what the hook uses.
    globalThis.WebSocket = FakeSocket;
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('says hello as soon as it connects', () => {
    const { result } = renderHook(() => useOnline(true), { wrapper });
    const live = FakeSocket.instances.at(-1)!;
    live.open();

    expect(live.frames()[0]).toMatchObject({ t: 'hello' });
    expect(result.current.connection).toBe('online');
  });

  it('still sends after a replaced socket closes late', () => {
    // The hazard: two sockets exist for a moment and the *older* one's close
    // event lands after the newer one is already live. React's development
    // double-mount does this on every page load; toggling the online tab does
    // it too. If that close clears the shared reference, every later message
    // goes into a queue nobody drains — which in the browser looked exactly
    // like "I press Create room and nothing happens".
    const { result, rerender } = renderHook(({ on }: { on: boolean }) => useOnline(on), {
      wrapper,
      initialProps: { on: true },
    });

    const stale = FakeSocket.instances[0]!;
    rerender({ on: false }); // tears down, but the close event has not fired yet
    rerender({ on: true }); // a second socket is installed

    const live = FakeSocket.instances.at(-1)!;
    expect(live).not.toBe(stale);

    live.open();
    stale.fireClose(); // out of order, on purpose

    act(() => result.current.createRoom('Roman', DEFAULT_RULES));

    expect(live.frames().map((f) => f.t)).toContain('room.create');
    expect(result.current.connection).toBe('online');
  });

  it('queues what you did while the line was down, then sends it', () => {
    const { result } = renderHook(() => useOnline(true), { wrapper });
    const first = FakeSocket.instances.at(-1)!;

    // Never opened: the click has nowhere to go yet.
    act(() => result.current.createRoom('Roman', DEFAULT_RULES));
    expect(first.frames().map((f) => f.t)).not.toContain('room.create');

    first.open();
    expect(first.frames().map((f) => f.t)).toEqual(['hello', 'room.create']);
  });

  it('reports the line as down when the live socket drops', () => {
    const { result } = renderHook(() => useOnline(true), { wrapper });
    const live = FakeSocket.instances.at(-1)!;
    live.open();
    expect(result.current.connection).toBe('online');

    live.fireClose();
    expect(result.current.connection).toBe('offline');
  });

  it('keeps the token it was given, so a refresh finds the same seat', () => {
    const { result } = renderHook(() => useOnline(true), { wrapper });
    const live = FakeSocket.instances.at(-1)!;
    live.open();

    act(() =>
      live.onmessage?.({
        data: JSON.stringify({
          t: 'hello.ok',
          token: 'abc123',
          playerId: 'p1',
          room: null,
          protocol: 1,
        }),
      }),
    );

    expect(localStorage.getItem('durak.token')).toBe('abc123');
    expect(result.current.playerId).toBe('p1');
  });

  it('opens nothing at all until the online tab is chosen', () => {
    renderHook(() => useOnline(false), { wrapper });
    expect(FakeSocket.instances).toHaveLength(0);
  });
});
