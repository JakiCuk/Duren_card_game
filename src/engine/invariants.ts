import { beats, fullDeck } from './cards.js';
import { actorsToAct, attackCap, ctxOf } from './legality.js';
import type { GameState } from './state.js';
import { tableCards } from './state.js';

/**
 * Properties that must hold after *every* move. The fuzzer asserts all of them
 * on every state it visits, which is what turns a random game generator into a
 * rules-correctness oracle.
 *
 * Returns human-readable violations rather than throwing, so the fuzzer can
 * report all of them together with the reproducing seed.
 */
export function checkInvariants(s: GameState): string[] {
  const problems: string[] = [];

  // 1. Card conservation. If this ever breaks, everything downstream is noise.
  const seen = new Map<number, number>();
  const count = (card: number, where: string): void => {
    const prev = seen.get(card) ?? 0;
    if (prev > 0) problems.push(`duplicate card ${card} (second sighting in ${where})`);
    seen.set(card, prev + 1);
  };
  for (const p of s.players) for (const c of p.hand) count(c, `hand of seat ${p.seat}`);
  for (const c of s.deck) count(c, 'deck');
  for (const c of s.discard) count(c, 'discard');
  for (const c of tableCards(s)) count(c, 'table');

  const expected = fullDeck(s.config.deckSize);
  if (seen.size !== expected.length) {
    problems.push(`card count is ${seen.size}, expected ${expected.length}`);
  }
  for (const card of expected) {
    if (!seen.has(card)) problems.push(`card ${card} vanished`);
  }

  // 2. Hands stay canonically sorted, otherwise hashState is not comparable.
  for (const p of s.players) {
    for (let i = 1; i < p.hand.length; i++) {
      if (p.hand[i - 1]! >= p.hand[i]!) {
        problems.push(`hand of seat ${p.seat} is not sorted/unique`);
        break;
      }
    }
  }

  // 3. Every defence on the table really beats the attack it covers.
  s.table.forEach((slot, i) => {
    if (slot.defence !== null && !beats(slot.defence, slot.attack, s.trump)) {
      problems.push(`slot ${i}: ${slot.defence} does not beat ${slot.attack}`);
    }
  });

  // 4. The table never exceeds the effective cap.
  const ctx = ctxOf(s);
  if (s.table.length > attackCap(ctx)) {
    problems.push(`table has ${s.table.length} slots, cap is ${attackCap(ctx)}`);
  }

  if (s.passed.length !== s.players.length) problems.push('passed[] does not cover every seat');

  if (s.phase === 'bout') {
    // 5. Somebody can always move while the game is running — otherwise the
    //    engine has produced a state that needs an external nudge.
    if (actorsToAct(s).length === 0) problems.push('no player can move but the game is not finished');

    if (s.attacker === s.defender) problems.push('attacker and defender are the same seat');
    if (s.players[s.attacker]?.outAtStep !== null) problems.push('attacker has already gone out');
    if (s.players[s.defender]?.outAtStep !== null) problems.push('defender has already gone out');

    // 6. Anyone still in the game holds cards: refill guarantees it while the
    //    deck lasts, and an empty hand with an empty deck means "out".
    for (const p of s.players) {
      if (p.outAtStep === null && p.hand.length === 0 && s.deck.length === 0 && s.table.length === 0) {
        problems.push(`seat ${p.seat} is active with no cards and an empty deck`);
      }
    }
    if (s.result !== null) problems.push('result is set while the game is still running');
  } else {
    if (s.result === null) problems.push('finished game has no result');
    if (s.table.length > 0) problems.push('finished game still has cards on the table');
  }

  // 7. The trump card is present exactly while the deck is.
  if (s.deck.length === 0 && s.trumpCard !== null) problems.push('deck is empty but a trump card remains');
  if (s.deck.length > 0 && s.trumpCard === null) problems.push('deck is non-empty but the trump card is gone');

  return problems;
}

export function assertInvariants(s: GameState, context = ''): void {
  const problems = checkInvariants(s);
  if (problems.length > 0) {
    throw new Error(`Invariant violation${context ? ` (${context})` : ''}:\n  - ${problems.join('\n  - ')}`);
  }
}
