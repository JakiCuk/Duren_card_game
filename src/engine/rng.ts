/**
 * sfc32 — small, fast, statistically sound, and above all *serializable*.
 *
 * The generator state is a plain object that lives inside `GameState`, so a
 * whole game is determined by `(config, seats, seed, moves)`. That is what turns
 * a bug report into a 200-byte JSON blob and lets the fuzzer replay any failure.
 */
export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** xmur3: string/number → a stream of well-mixed 32-bit seeds. */
function xmur3(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

export function seedRng(seed: number | string): RngState {
  const next = xmur3(String(seed));
  const state: RngState = { a: next(), b: next(), c: next(), d: next() };
  // Discard the first outputs: sfc32 needs a few rounds before its state is
  // well mixed, and adjacent seeds would otherwise produce similar first draws.
  for (let i = 0; i < 15; i++) nextU32(state);
  return state;
}

export const cloneRng = (r: RngState): RngState => ({ a: r.a, b: r.b, c: r.c, d: r.d });

/** Advances `r` in place and returns a uniform 32-bit unsigned integer. */
export function nextU32(r: RngState): number {
  const t = (((r.a + r.b) | 0) + r.d) | 0;
  r.d = (r.d + 1) | 0;
  r.a = r.b ^ (r.b >>> 9);
  r.b = (r.c + (r.c << 3)) | 0;
  r.c = (r.c << 21) | (r.c >>> 11);
  r.c = (r.c + t) | 0;
  return t >>> 0;
}

/**
 * Uniform integer in [0, bound). Rejection-sampled rather than modulo-reduced,
 * so a shuffle of 36 cards is not measurably biased towards low indices.
 */
export function nextInt(r: RngState, bound: number): number {
  if (bound <= 0 || !Number.isInteger(bound)) throw new RangeError(`bound must be a positive integer, got ${bound}`);
  const limit = 0x1_0000_0000 - (0x1_0000_0000 % bound);
  let x = nextU32(r);
  while (x >= limit) x = nextU32(r);
  return x % bound;
}

/** Fisher-Yates, descending. */
export function shuffleInPlace<T>(arr: T[], r: RngState): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(r, i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}
