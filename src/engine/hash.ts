import type { GameState } from './state.js';

/**
 * FNV-1a over a canonical rendering of the whole state.
 *
 * Its only job is to be a tripwire: a recorded `(config, seed, moves, hash)`
 * replay fails the moment any rule quietly changes behaviour. It is not a
 * cryptographic hash and must never be used as one.
 */
export function hashState(s: GameState): string {
  let h = 0x811c9dc5;
  const feed = (n: number): void => {
    h ^= n & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (n >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (n >>> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (n >>> 24) & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  const feedAll = (xs: readonly number[]): void => {
    feed(xs.length);
    for (const x of xs) feed(x);
  };

  feed(s.phase === 'finished' ? 1 : 0);
  feed(s.step);
  feed(s.trump);
  feed(s.trumpCard ?? -1);
  feed(s.attacker);
  feed(s.defender);
  feed(s.boutIndex);
  feed(s.defenderTaking ? 1 : 0);
  feed(s.defenderHandAtBoutStart);
  feed(s.transfersThisBout);
  feed(s.boutsWithoutProgress);
  feed(s.rng.a);
  feed(s.rng.b);
  feed(s.rng.c);
  feed(s.rng.d);

  feed(s.players.length);
  for (const p of s.players) {
    feedAll(p.hand);
    feed(p.outAtStep ?? -1);
  }
  feedAll(s.deck);
  feedAll(s.discard);
  feed(s.table.length);
  for (const slot of s.table) {
    feed(slot.attack);
    feed(slot.defence ?? -1);
  }
  feedAll(s.passed.map((b) => (b ? 1 : 0)));

  return (h >>> 0).toString(16).padStart(8, '0');
}
