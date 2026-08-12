/**
 * Closed-form hypergeometric probabilities.
 *
 * Sampling would be simpler to write and much slower to run, and these are the
 * numbers a level-3 bot needs on every decision: "can they beat this?", "is
 * there a trump left?", "how many of my attacks can they answer?".
 */

/** log C(n, k), so the ratios below never overflow on a 52-card deck. */
function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  let total = 0;
  const m = Math.min(k, n - k);
  for (let i = 1; i <= m; i++) total += Math.log(n - m + i) - Math.log(i);
  return total;
}

/**
 * The chance that a hand of `handSize` cards drawn from `poolSize` unknown ones
 * contains at least one of the `favourable` cards.
 *
 * `1 − C(pool−favourable, hand) / C(pool, hand)`: the complement of drawing
 * only from the rest.
 */
export function atLeastOne(poolSize: number, favourable: number, handSize: number): number {
  if (favourable <= 0 || handSize <= 0) return 0;
  if (handSize >= poolSize) return favourable > 0 ? 1 : 0;
  if (favourable >= poolSize) return 1;
  const none = Math.exp(logChoose(poolSize - favourable, handSize) - logChoose(poolSize, handSize));
  return Math.min(Math.max(1 - none, 0), 1);
}

/** Expected number of favourable cards in a hand of that size. */
export function expectedCount(poolSize: number, favourable: number, handSize: number): number {
  if (poolSize <= 0) return 0;
  return (favourable * handSize) / poolSize;
}

/**
 * Probability that a specific named card sits in a hand of `handSize` drawn
 * from `poolSize`.
 */
export function holdsCard(poolSize: number, handSize: number): number {
  if (poolSize <= 0) return 0;
  return Math.min(handSize / poolSize, 1);
}
