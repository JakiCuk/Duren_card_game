import { randomBytes } from 'node:crypto';

export interface Session {
  token: string;
  playerId: string;
  name: string;
  roomCode: string | null;
  expiresAt: number;
}

/**
 * Identity without accounts.
 *
 * The token *is* the player: it is minted on first contact, stored in the
 * browser's localStorage, and lets somebody reclaim their seat after a refresh
 * or a dropped connection. Nothing is persisted server-side beyond this map, so
 * a restart genuinely does end the party — which is the deal anonymous rooms
 * make in exchange for needing no database and no sign-up.
 */
export class SessionStore {
  private byToken = new Map<string, Session>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(ttlMs = 2 * 60 * 60 * 1000, now: () => number = () => Date.now()) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  get size(): number {
    return this.byToken.size;
  }

  create(name: string): Session {
    const token = randomBytes(16).toString('hex');
    const session: Session = {
      token,
      playerId: randomBytes(8).toString('hex'),
      name,
      roomCode: null,
      expiresAt: this.now() + this.ttlMs,
    };
    this.byToken.set(token, session);
    return session;
  }

  resume(token: string | undefined): Session | null {
    if (token === undefined) return null;
    const session = this.byToken.get(token);
    if (!session) return null;
    if (session.expiresAt < this.now()) {
      this.byToken.delete(token);
      return null;
    }
    session.expiresAt = this.now() + this.ttlMs;
    return session;
  }

  /** Resume an existing session or mint a fresh one — the common entry path. */
  hello(token: string | undefined, name: string): Session {
    return this.resume(token) ?? this.create(name);
  }

  sweep(): number {
    const now = this.now();
    let dropped = 0;
    for (const [token, session] of this.byToken) {
      if (session.expiresAt < now) {
        this.byToken.delete(token);
        dropped++;
      }
    }
    return dropped;
  }
}
