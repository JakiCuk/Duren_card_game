// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
// Named import, not default: under NodeNext resolution the default export of
// this package does not carry its type.
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/client/App.js';

afterEach(cleanup);

const seatPanels = () => screen.getAllByRole('region');

/**
 * The seat currently marked as attacking. Read from the seat badge rather than
 * from any text containing "útočí" — the empty table prints the same word.
 */
const attackerName = (): string => {
  const seat = Array.from(document.querySelectorAll('.seat')).find((el) =>
    el.querySelector('.seat__roles')?.textContent?.includes('útočí'),
  );
  const name = seat?.querySelector('.seat__name')?.textContent;
  if (!name) throw new Error('No seat is marked as attacking');
  return name;
};

/** All card images currently rendered inside the table area. */
const tableCards = (): HTMLElement[] => {
  const table = screen.getByLabelText('Stôl');
  return within(table).queryAllByRole('img');
};

const seatSection = (name: string): HTMLElement => {
  const heading = screen.getByRole('button', { name });
  const section = heading.closest('section');
  if (!section) throw new Error(`No seat panel for ${name}`);
  return section;
};

const handCards = (name: string): HTMLElement[] =>
  Array.from(seatSection(name).querySelectorAll('.hand .card img'));

const playableCards = (name: string): HTMLElement[] =>
  Array.from(seatSection(name).querySelectorAll('.hand button.card:not(:disabled)')).filter(
    (el) => !el.classList.contains('card--muted'),
  ) as HTMLElement[];

describe('hot-seat board', () => {
  it('deals a visible game to every seat', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Durak' })).toBeTruthy();
    expect(handCards('Hráč 1')).toHaveLength(6);
    expect(handCards('Hráč 2')).toHaveLength(6);
    expect(tableCards()).toHaveLength(0);
    expect(screen.getByTitle(/^Tromf:/)).toBeTruthy();
  });

  it('plays a card from the attacking hand onto the table', async () => {
    const user = userEvent.setup();
    render(<App />);

    const attacker = attackerName();
    const before = handCards(attacker).length;
    const options = playableCards(attacker);
    expect(options.length).toBeGreaterThan(0);

    await user.click(options[0]!);

    expect(tableCards().length).toBeGreaterThanOrEqual(1);
    expect(handCards(attacker)).toHaveLength(before - 1);
  });

  it('offers the defender a way to take the cards, and takes them', async () => {
    const user = userEvent.setup();
    render(<App />);

    const attacker = attackerName();
    await user.click(playableCards(attacker)[0]!);

    const defenderName = attacker === 'Hráč 1' ? 'Hráč 2' : 'Hráč 1';
    const handBefore = handCards(defenderName).length;

    // Hot-seat: the attacker may still be able to throw in, so control does not
    // jump on its own. Hand the device to the defender.
    const handover = screen.queryByRole('button', { name: `Prepnúť na ${defenderName}` });
    if (handover) await user.click(handover);

    await user.click(screen.getByRole('button', { name: 'Beriem' }));

    // Declaring a take does not collect the cards: the attackers still get to
    // pile on. The defender's hand only grows once the bout actually resolves.
    if (tableCards().length > 0) {
      expect(seatSection(defenderName).textContent).toContain('berie');
      expect(handCards(defenderName)).toHaveLength(handBefore);

      const back = screen.queryByRole('button', { name: `Prepnúť na ${attacker}` });
      if (back) await user.click(back);
      await user.click(screen.getByRole('button', { name: 'Bito / koniec prihadzovania' }));
    }

    expect(tableCards()).toHaveLength(0);
    expect(handCards(defenderName).length).toBeGreaterThan(handBefore);
  });

  it('undoes the last move', async () => {
    const user = userEvent.setup();
    render(<App />);

    const attacker = attackerName();
    await user.click(playableCards(attacker)[0]!);
    expect(tableCards().length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole('button', { name: 'Späť' }));
    expect(tableCards()).toHaveLength(0);
    expect(handCards(attacker)).toHaveLength(6);
  });

  it('deals the same cards again for the same seed', async () => {
    const user = userEvent.setup();
    render(<App />);

    const seed = screen.getByTitle(/Rovnaký seed/);
    await user.clear(seed);
    await user.type(seed, 'repeatable');
    await user.click(screen.getByRole('button', { name: 'Nová hra' }));
    const first = handCards('Hráč 1').map((img) => img.getAttribute('alt'));

    await user.click(screen.getByRole('button', { name: 'Nová hra' }));
    expect(handCards('Hráč 1').map((img) => img.getAttribute('alt'))).toEqual(first);
  });

  it('can be played from the deal to a durak using only the UI', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Clicks whatever the board currently offers until somebody is the fool.
    // If the UI ever fails to offer a move the game would stall here, which is
    // exactly the failure this test exists to catch.
    for (let step = 0; step < 400; step++) {
      if (screen.queryByText(/^Durak je |^Remíza/)) break;

      const cards = Array.from(document.querySelectorAll('.seat--active .hand button.card')).filter(
        (el) => !el.classList.contains('card--muted'),
      ) as HTMLElement[];
      const buttons = ['Beriem', 'Bito / koniec prihadzovania']
        .map((name) => screen.queryByRole('button', { name }))
        .filter((b): b is HTMLElement => b !== null);
      const switches = screen.queryAllByRole('button', { name: /^Prepnúť na / });

      const choice = cards[step % Math.max(cards.length, 1)] ?? buttons[0] ?? switches[0];
      expect(choice, `no move offered at step ${step}`).toBeTruthy();
      await user.click(choice!);
    }

    expect(screen.getByText(/^Durak je |^Remíza/)).toBeTruthy();
    // Exactly one seat may still hold cards — the fool. A draw leaves none.
    const withCards = Array.from(document.querySelectorAll('.seat')).filter(
      (el) => el.querySelectorAll('.hand .card img').length > 0,
    );
    expect(withCards.length).toBeLessThanOrEqual(1);
  }, 60_000);

  it('refuses a table the deck cannot supply, and says why', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.selectOptions(screen.getByLabelText('Hráčov'), '6');
    expect(screen.getByText(/nestačí pre 6 hráčov/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nová hra' }).hasAttribute('disabled')).toBe(true);

    await user.selectOptions(screen.getByLabelText('Balík'), '52');
    expect(screen.queryByText(/nestačí pre 6 hráčov/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Nová hra' }));
    expect(seatPanels().length).toBeGreaterThanOrEqual(6);
  });
});
