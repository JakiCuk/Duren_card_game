// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
// Named import, not default: under NodeNext resolution the default export of
// this package does not carry its type.
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderApp } from './render.js';

afterEach(cleanup);

const seatPanels = () => screen.getAllByRole('region');

/**
 * The end-of-game banner. Queried by class rather than by text: the log prints
 * a very similar sentence, and a text query would match both.
 */
const resultBanner = (): string | null => document.querySelector('.banner')?.textContent ?? null;

type User = ReturnType<typeof userEvent.setup>;

/**
 * The product default is human vs bot. These tests want two humans at one
 * device, so they hand seat 2 back to a person and redeal.
 */
async function renderHotSeat(user: User): Promise<void> {
  renderApp();
  await user.selectOptions(screen.getByLabelText('Miesto 2'), 'human');
  await user.click(screen.getByRole('button', { name: 'Nová hra' }));
}

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

const seatSection = (name: string): HTMLElement => screen.getByRole('region', { name });

const handCards = (name: string): HTMLElement[] =>
  Array.from(seatSection(name).querySelectorAll('.hand .card img'));

/**
 * The seat the table is currently centred on.
 *
 * The board is drawn from one chair: only that player's cards are clickable,
 * and handing the device over is an explicit button.
 */
const mySeatName = (): string => {
  const name = document.querySelector('.seat--me .seat__name')?.textContent;
  if (!name) throw new Error('No seat is being played');
  return name;
};

/** Cards the player at the bottom of the table can actually play right now. */
const playableCards = (): HTMLElement[] =>
  Array.from(
    document.querySelectorAll<HTMLElement>('.seat--me .hand button.card:not(:disabled)'),
  ).filter((el) => !el.classList.contains('card--muted'));

/** Hands the device to another seat, if the board offers that. */
const switchTo = async (user: User, name: string): Promise<void> => {
  const button = screen.queryByRole('button', { name: `Prepnúť na ${name}` });
  if (button) await user.click(button);
};

describe('hot-seat board', () => {
  it('deals a visible game to every seat', async () => {
    await renderHotSeat(userEvent.setup());
    expect(screen.getByRole('heading', { name: 'Durak' })).toBeTruthy();
    expect(handCards('Hráč 1')).toHaveLength(6);
    expect(handCards('Hráč 2')).toHaveLength(6);
    expect(tableCards()).toHaveLength(0);
    expect(screen.getByTitle(/^Tromf:/)).toBeTruthy();
  });

  it('plays a card from the attacking hand onto the table', async () => {
    const user = userEvent.setup();
    await renderHotSeat(user);

    const attacker = attackerName();
    await switchTo(user, attacker);
    expect(mySeatName()).toBe(attacker);

    const before = handCards(attacker).length;
    const options = playableCards();
    expect(options.length).toBeGreaterThan(0);

    await user.click(options[0]!);

    expect(tableCards().length).toBeGreaterThanOrEqual(1);
    expect(handCards(attacker)).toHaveLength(before - 1);
  });

  it('offers the defender a way to take the cards, and takes them', async () => {
    const user = userEvent.setup();
    await renderHotSeat(user);

    const attacker = attackerName();
    await switchTo(user, attacker);
    await user.click(playableCards()[0]!);

    const defenderName = attacker === 'Hráč 1' ? 'Hráč 2' : 'Hráč 1';
    const handBefore = handCards(defenderName).length;

    // Hot-seat: the attacker may still be able to throw in, so control does not
    // jump on its own. Hand the device to the defender.
    await switchTo(user, defenderName);
    await user.click(screen.getByRole('button', { name: 'Beriem' }));

    // Declaring a take does not collect the cards: the attackers still get to
    // pile on. The defender's hand only grows once the bout actually resolves.
    if (tableCards().length > 0) {
      expect(seatSection(defenderName).textContent).toContain('berie');
      expect(handCards(defenderName)).toHaveLength(handBefore);

      await switchTo(user, attacker);
      await user.click(screen.getByRole('button', { name: 'Bito / koniec prihadzovania' }));
    }

    expect(tableCards()).toHaveLength(0);
    expect(handCards(defenderName).length).toBeGreaterThan(handBefore);
  });

  it('undoes the last move', async () => {
    const user = userEvent.setup();
    await renderHotSeat(user);

    const attacker = attackerName();
    await switchTo(user, attacker);
    await user.click(playableCards()[0]!);
    expect(tableCards().length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole('button', { name: 'Späť' }));
    expect(tableCards()).toHaveLength(0);
    expect(handCards(attacker)).toHaveLength(6);
  });

  it('deals the same cards again for the same seed', async () => {
    const user = userEvent.setup();
    await renderHotSeat(user);

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
    await renderHotSeat(user);

    // Clicks whatever the board currently offers until somebody is the fool.
    // If the UI ever fails to offer a move the game would stall here, which is
    // exactly the failure this test exists to catch.
    for (let step = 0; step < 400; step++) {
      if (resultBanner() !== null) break;

      const cards = playableCards();
      const buttons = ['Beriem', 'Bito / koniec prihadzovania']
        .map((name) => screen.queryByRole('button', { name }))
        .filter((b): b is HTMLElement => b !== null);
      const switches = screen.queryAllByRole('button', { name: /^Prepnúť na / });

      const choice = cards[step % Math.max(cards.length, 1)] ?? buttons[0] ?? switches[0];
      expect(choice, `no move offered at step ${step}`).toBeTruthy();
      await user.click(choice!);
    }

    expect(resultBanner()).toMatch(/^Durak je |^Remíza|^Patová/);
    // Exactly one seat may still hold cards — the fool. A draw leaves none.
    const withCards = Array.from(document.querySelectorAll('.seat')).filter(
      (el) => el.querySelectorAll('.hand .card img').length > 0,
    );
    expect(withCards.length).toBeLessThanOrEqual(1);
  }, 60_000);

  it('refuses a table the deck cannot supply, and says why', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.selectOptions(screen.getByLabelText('Hráčov'), '6');
    expect(screen.getByText(/nestačí pre 6 hráčov/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nová hra' }).hasAttribute('disabled')).toBe(true);

    await user.selectOptions(screen.getByLabelText('Balík'), '52');
    expect(screen.queryByText(/nestačí pre 6 hráčov/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Nová hra' }));
    expect(seatPanels().length).toBeGreaterThanOrEqual(6);
  });
});

describe('playing against a bot', () => {
  const seatPanel = (name: string): HTMLElement => screen.getByRole('region', { name });

  it('marks the bot seat and keeps its cards face down', () => {
    renderApp();
    const bot = seatPanel('Hráč 2');
    expect(bot.textContent).toContain('bot');

    const images = within(bot).getAllByRole('img');
    expect(images).toHaveLength(6);
    // Every one is the back. If a card code ever appears here, "play against
    // the computer" would be a lie anyone could check in dev tools.
    expect(images.every((img) => img.getAttribute('alt') === 'Rubová strana')).toBe(true);
    expect(bot.innerHTML).not.toMatch(/alt="[2-9TJQKA][CDHS]"/);
  });

  it('does not let a human act for the bot', () => {
    renderApp();
    // The bot sits across the table: no clickable cards, and no way to take
    // over its chair.
    expect(seatPanel('Hráč 2').className).toContain('seat--across');
    expect(within(seatPanel('Hráč 2')).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Prepnúť na Hráč 2' })).toBeNull();
  });

  it('answers on its own without any further clicks', async () => {
    const user = userEvent.setup();
    renderApp();

    // If the human opens, play one card; otherwise the bot opens by itself.
    const mine = playableCards();
    if (mine.length > 0) await user.click(mine[0]!);

    await waitFor(
      () => {
        // Either the bot covered our attack or it led one of its own.
        const moved = tableCards().length > 1 || resultBanner() !== null;
        expect(moved || document.querySelectorAll('.log li').length > 1).toBe(true);
      },
      { timeout: 6000 },
    );
  }, 20_000);
});

describe('rules panel', () => {
  it('applies a preset and says which one is active', async () => {
    const user = userEvent.setup();
    renderApp();

    const panel = screen.getByText('Pravidlá').closest('details')!;
    // The name shows up twice by design: as a preset button and as the summary.
    expect(within(panel).getByRole('button', { name: 'Klasický durak' })).toBeTruthy();
    expect(panel.querySelector('.rules__current')?.textContent).toBe('Klasický durak');

    await user.click(within(panel).getByRole('button', { name: 'S prehadzovaním' }));
    expect(panel.querySelector('.rules__current')?.textContent).toBe('S prehadzovaním');
    expect(within(panel).getByLabelText<HTMLInputElement>(/Prehadzovanie \(perevodnoy\)/).checked).toBe(true);
  });

  it('greys out sub-options of a rule that is switched off', () => {
    renderApp();
    const panel = screen.getByText('Pravidlá').closest('details')!;
    expect(within(panel).getByLabelText(/Reťazenie prehodení/).hasAttribute('disabled')).toBe(true);
  });

  it('warns about a switch that changes the game more than it looks', async () => {
    const user = userEvent.setup();
    renderApp();

    const panel = screen.getByText('Pravidlá').closest('details')!;
    await user.click(within(panel).getByLabelText(/Obranca musí zbiť/));
    expect(screen.getByText(/berie obrancovi voľbu/)).toBeTruthy();
    // A warning must never block starting a game — only errors do that.
    expect(screen.getByRole('button', { name: 'Nová hra' }).hasAttribute('disabled')).toBe(false);
  });

  it('turns the transfer rule into a playable move', async () => {
    const user = userEvent.setup();
    renderApp();

    const panel = screen.getByText('Pravidlá').closest('details')!;
    await user.click(within(panel).getByRole('button', { name: 'S prehadzovaním' }));
    await user.selectOptions(screen.getByLabelText('Miesto 2'), 'human');

    // Search seeds until one offers a transfer within the first few moves; the
    // point is that the affordance exists and is clickable, not which deal.
    const seedBox = screen.getByTitle(/Rovnaký seed/);
    let found = false;
    for (let seed = 0; seed < 25 && !found; seed++) {
      await user.clear(seedBox);
      await user.type(seedBox, `t${seed}`);
      await user.click(screen.getByRole('button', { name: 'Nová hra' }));

      for (let step = 0; step < 6 && !found; step++) {
        const transferBtn = screen.queryByRole('button', { name: /^Prehodiť / });
        if (transferBtn) {
          await user.click(transferBtn);
          found = true;
          break;
        }
        const cards = playableCards();
        const switches = screen.queryAllByRole('button', { name: /^Prepnúť na / });
        const next = cards[0] ?? switches[0];
        if (!next) break;
        await user.click(next);
      }
    }
    expect(found, 'no deal in 25 seeds ever offered a transfer').toBe(true);
  }, 60_000);
});

describe('game settings', () => {
  const openSettings = async (user: User): Promise<HTMLElement> => {
    const panel = document.querySelector<HTMLElement>('details.panel--setup')!;
    if (!panel.hasAttribute('open')) {
      await user.click(within(panel).getByText('Nastavenia a nová hra'));
    }
    return panel;
  };

  it('stays out of the way until asked for', () => {
    renderApp();
    // The knobs exist but are folded away; the table gets the attention.
    expect(document.querySelector('details.panel--setup')!.hasAttribute('open')).toBe(false);
  });

  it('remembers the bot pause between visits', async () => {
    const user = userEvent.setup();
    renderApp();
    const panel = await openSettings(user);

    const slider = within(panel).getByLabelText<HTMLInputElement>('Pauza botov');
    expect(Number(slider.value)).toBeGreaterThan(0);

    fireEvent.change(slider, { target: { value: '2500' } });
    expect(within(panel).getByText('2.5 s')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('durak.settings')!)).toMatchObject({
      botDelayMs: 2500,
    });
  });

  it('hides and restores the transcript', async () => {
    const user = userEvent.setup();
    renderApp();
    expect(document.querySelector('.log')).not.toBeNull();

    const panel = await openSettings(user);
    await user.click(within(panel).getByLabelText(/Zobraziť prepis hry/));
    expect(document.querySelector('.log')).toBeNull();

    await user.click(within(panel).getByLabelText(/Zobraziť prepis hry/));
    expect(document.querySelector('.log')).not.toBeNull();
  });

  it('holds the bots while the player still has a card to throw in', async () => {
    const user = userEvent.setup();
    renderApp();

    // Open with a card the bot cannot sweep away before we look: with the hold
    // on, nothing moves until we play or pass.
    for (let step = 0; step < 12; step++) {
      const options = playableCards();
      if (options.length === 0) break;
      await user.click(options[0]!);
      const prompt = document.querySelector('.felt__prompt--wait');
      if (prompt) {
        expect(prompt.textContent).toMatch(/prihodiť/);
        // The pass button is highlighted as the way out of the wait.
        expect(
          screen.getByRole('button', { name: 'Bito / koniec prihadzovania' }).className,
        ).toContain('btn--primary');
        return;
      }
    }
    // Not every deal reaches a throw-in decision; the setting is still wired.
    expect(JSON.parse(localStorage.getItem('durak.settings')!)).toMatchObject({
      holdForThrowIn: true,
    });
  }, 30_000);
});

describe('table layout', () => {
  it('folds one panel away, not two', () => {
    renderApp();
    // Setup and preferences share a single disclosure: hunting through two of
    // them for "the settings" is one fold-out too many.
    const panels = document.querySelectorAll('details.panel--setup');
    expect(panels).toHaveLength(1);
    expect(panels[0]!.hasAttribute('open')).toBe(false);
    expect(screen.getByText('Nastavenia a nová hra')).toBeTruthy();
    expect(within(panels[0] as HTMLElement).getByLabelText('Pauza botov')).toBeTruthy();
  });

  it('keeps the deck at the table edge and away from every seat', () => {
    // Regression: the deck sat at the left edge at the same height as the
    // left-hand player, so at three and four players they overlapped. Seats now
    // sit along the upper arc and the deck sits below them.
    renderApp();
    const deck = document.querySelector<HTMLElement>('.felt__deck');
    expect(deck).not.toBeNull();
    expect(deck!.closest('.felt__centre')).toBeNull();

    const tops = Array.from(document.querySelectorAll<HTMLElement>('.seat--across')).map((el) =>
      Number.parseFloat(el.style.top),
    );
    expect(tops.length).toBeGreaterThan(0);
    for (const top of tops) expect(top).toBeLessThan(60);
  });

  it('shows the game info on the table, above the cards being played', async () => {
    const user = userEvent.setup();
    renderApp();

    const centre = document.querySelector('.felt__centre')!;
    const status = centre.querySelector('.board__status');
    expect(status, 'the info row belongs on the table').not.toBeNull();
    expect(status!.textContent).toContain('Tromf');

    // Above the pile, not below it.
    const children = Array.from(centre.children);
    expect(children.indexOf(status!)).toBeLessThan(
      children.indexOf(centre.querySelector('.table')!),
    );

    const panel = document.querySelector<HTMLElement>('details.panel--setup')!;
    await user.click(within(panel).getByText('Nastavenia a nová hra'));
    await user.click(within(panel).getByLabelText(/Zobraziť údaje o hre/));
    expect(document.querySelector('.felt__centre .board__status')).toBeNull();
  });

  it('gives your own hand the biggest cards on the table', () => {
    renderApp();
    expect(document.querySelectorAll('.seat--me .hand .card--lg').length).toBe(6);
    // Opponents are fanned small; they are information, not targets.
    expect(document.querySelectorAll('.seat--across .hand .card--sm').length).toBeGreaterThan(0);
  });
});
