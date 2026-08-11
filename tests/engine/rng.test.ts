import { describe, expect, it } from 'vitest';
import { cloneRng, nextInt, nextU32, seedRng, shuffleInPlace } from '../../src/engine/rng.js';

describe('seeded rng', () => {
  it('is reproducible from a seed and independent between instances', () => {
    const a = seedRng('durak');
    const b = seedRng('durak');
    const c = seedRng('durab');
    const draw = (r: ReturnType<typeof seedRng>) => Array.from({ length: 20 }, () => nextU32(r));
    expect(draw(a)).toEqual(draw(b));
    expect(draw(seedRng('durak'))).not.toEqual(draw(c));
  });

  it('clones without sharing state', () => {
    const r = seedRng(7);
    const copy = cloneRng(r);
    expect(nextU32(r)).toBe(nextU32(copy));
    nextU32(r);
    expect(nextU32(r)).not.toBe(nextU32(copy));
  });

  it('separates adjacent numeric seeds', () => {
    const first = (seed: number) => nextU32(seedRng(seed));
    const values = new Set(Array.from({ length: 500 }, (_, i) => first(i)));
    expect(values.size).toBe(500);
  });

  it('produces integers strictly inside the bound', () => {
    const r = seedRng('bounds');
    const counts = new Array<number>(6).fill(0);
    let outOfRange = 0;
    for (let i = 0; i < 60_000; i++) {
      const v = nextInt(r, 6);
      if (!Number.isInteger(v) || v < 0 || v >= 6) outOfRange++;
      else counts[v]!++;
    }
    expect(outOfRange).toBe(0);
    // Rejection sampling, so the distribution should be flat well within 5 %.
    for (const c of counts) expect(Math.abs(c - 10_000)).toBeLessThan(500);
  });

  it('rejects a non-positive bound rather than returning NaN', () => {
    const r = seedRng(1);
    expect(() => nextInt(r, 0)).toThrow();
    expect(() => nextInt(r, -3)).toThrow();
    expect(() => nextInt(r, 2.5)).toThrow();
  });

  it('shuffles into a permutation, and differently for different seeds', () => {
    const base = Array.from({ length: 36 }, (_, i) => i);
    const one = base.slice();
    const two = base.slice();
    shuffleInPlace(one, seedRng('a'));
    shuffleInPlace(two, seedRng('b'));
    expect([...one].sort((x, y) => x - y)).toEqual(base);
    expect(one).not.toEqual(two);
    expect(one).not.toEqual(base);
  });

  it('does not favour any position (every card reaches every slot)', () => {
    const r = seedRng('spread');
    const positions = Array.from({ length: 6 }, () => new Set<number>());
    for (let i = 0; i < 2000; i++) {
      const arr = [0, 1, 2, 3, 4, 5];
      shuffleInPlace(arr, r);
      arr.forEach((card, slot) => positions[slot]!.add(card));
    }
    for (const seen of positions) expect(seen.size).toBe(6);
  });
});
