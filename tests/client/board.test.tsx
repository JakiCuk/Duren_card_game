// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
// Named import, not default: under NodeNext resolution the default export of
// this package does not carry its type.
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { openMenu, renderApp } from './render.js';

/** The header buttons that open the two pop-overs the tests need. */
const SETUP = /^Nastavenia a nová hra/;
const RULES = /^Pravidlá/;

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
  await openMenu(user, SETUP);
  await user.selectOptions(screen.getByLabelText('Miesto 2'), 'human');
  await user.click(screen.getByRole('button', { name: 'Nová hra' }));
  await closeMenus(user);
}

/** Dismisses whatever pop-over is open, so the table is clickable again. */
async function closeMenus(user: User): Promise<void> {
  const scrim = document.querySelector<HTMLElement>('.menu__scrim');
  if (scrim) await user.click(scrim);
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
    expect(screen.getByRole('heading', { name: 'Duren' })).toBeTruthy();
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

    await openMenu(user, SETUP);
    await user.click(screen.getByRole('button', { name: 'Späť' }));
    await closeMenus(user);
    expect(tableCards()).toHaveLength(0);
    expect(handCards(attacker)).toHaveLength(6);
  });

  it('deals the same cards again for the same seed', async () => {
    const user = userEvent.setup();
    await renderHotSeat(user);

    await openMenu(user, SETUP);
    const seed = screen.getByTitle(/Rovnaký seed/);
    await user.clear(seed);
    await user.type(seed, 'repeatable');
    await user.click(screen.getByRole('button', { name: 'Nová hra' }));
    const first = handCards('Hráč 1').map((img) => img.getAttribute('alt'));

    await user.click(screen.getByRole('button', { name: 'Nová hra' }));
    expect(handCards('Hráč 1').map((img) => img.getAttribute('alt'))).toEqual(first);
  });

  it('can be played from the deal to a duren using only the UI', async () => {
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

    expect(resultBanner()).toMatch(/^Duren je |^Remíza|^Patová/);
    // Exactly one seat may still hold cards — the fool. A draw leaves none.
    const withCards = Array.from(document.querySelectorAll('.seat')).filter(
      (el) => el.querySelectorAll('.hand .card img').length > 0,
    );
    expect(withCards.length).toBeLessThanOrEqual(1);
  }, 60_000);

  it('refuses a table the deck cannot supply, and says why', async () => {
    const user = userEvent.setup();
    renderApp();
    await openMenu(user, SETUP);

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

    // Card images only: the seat also carries a role pictogram, which is an
    // img in the accessibility tree and would otherwise be counted as a card.
    const images = Array.from(bot.querySelectorAll('.hand .card img'));
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
  const openRules = async (user: User): Promise<HTMLElement> => {
    await openMenu(user, RULES);
    return document.querySelector<HTMLElement>('.menu--rules details')!;
  };

  it('applies a preset and says which one is active', async () => {
    const user = userEvent.setup();
    renderApp();
    const panel = await openRules(user);

    // The name shows up twice by design: as a preset button and as the summary.
    expect(within(panel).getByRole('button', { name: 'Klasický duren' })).toBeTruthy();
    expect(panel.querySelector('.rules__current')?.textContent).toBe('Klasický duren');

    await user.click(within(panel).getByRole('button', { name: 'S prehadzovaním' }));
    expect(document.querySelector('.rules__current')?.textContent).toBe('S prehadzovaním');
    expect(
      screen.getByLabelText<HTMLInputElement>(/Prehadzovanie \(perevodnoy\)/).checked,
    ).toBe(true);
  });

  it('greys out sub-options of a rule that is switched off', async () => {
    const user = userEvent.setup();
    renderApp();
    const panel = await openRules(user);
    expect(within(panel).getByLabelText(/Reťazenie prehodení/).hasAttribute('disabled')).toBe(true);
  });

  it('warns about a switch that changes the game more than it looks', async () => {
    const user = userEvent.setup();
    renderApp();
    const panel = await openRules(user);

    await user.click(within(panel).getByLabelText(/Obranca musí zbiť/));
    // The warning belongs on the page, not inside the drawer that caused it.
    expect(screen.getByText(/berie obrancovi voľbu/)).toBeTruthy();
    expect(document.querySelector('.menu')!.contains(screen.getByText(/berie obrancovi voľbu/))).toBe(
      false,
    );

    await openMenu(user, SETUP);
    // A warning must never block starting a game — only errors do that.
    expect(screen.getByRole('button', { name: 'Nová hra' }).hasAttribute('disabled')).toBe(false);
  });

  it('turns the transfer rule into a playable move', async () => {
    const user = userEvent.setup();
    renderApp();

    const rules = await openRules(user);
    await user.click(within(rules).getByRole('button', { name: 'S prehadzovaním' }));
    await openMenu(user, SETUP);
    await user.selectOptions(screen.getByLabelText('Miesto 2'), 'human');

    // Search seeds until one offers a transfer within the first few moves; the
    // point is that the affordance exists and is clickable, not which deal.
    let found = false;
    for (let seed = 0; seed < 25 && !found; seed++) {
      await openMenu(user, SETUP);
      // Re-queried each pass: closing the drawer unmounts the field.
      const seedBox = screen.getByTitle(/Rovnaký seed/);
      await user.clear(seedBox);
      await user.type(seedBox, `t${seed}`);
      await user.click(screen.getByRole('button', { name: 'Nová hra' }));
      await closeMenus(user);

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
  it('stays out of the way until asked for', () => {
    renderApp();
    // The knobs exist but are folded away; the table gets the whole window.
    expect(document.querySelector('.menu')).toBeNull();
    expect(screen.getByRole('button', { name: SETUP })).toBeTruthy();
  });

  it('remembers the bot pause between visits', async () => {
    const user = userEvent.setup();
    renderApp();
    const panel = await openMenu(user, SETUP);

    const slider = within(panel).getByLabelText<HTMLInputElement>('Pauza botov');
    expect(Number(slider.value)).toBeGreaterThan(0);

    fireEvent.change(slider, { target: { value: '2500' } });
    expect(within(panel).getByText('2.5 s')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('duren.settings')!)).toMatchObject({
      botDelayMs: 2500,
    });
  });

  it('hides and restores the transcript', async () => {
    const user = userEvent.setup();
    renderApp();
    expect(document.querySelector('.log')).not.toBeNull();

    // One switch, not two: a header button doing the same job as this checkbox
    // is a second place to look for the same setting.
    expect(screen.queryByRole('button', { name: 'Priebeh' })).toBeNull();

    const panel = await openMenu(user, SETUP);
    await user.click(within(panel).getByLabelText(/Zobraziť prepis hry/));
    expect(document.querySelector('.log')).toBeNull();

    await user.click(within(panel).getByLabelText(/Zobraziť prepis hry/));
    expect(document.querySelector('.log')).not.toBeNull();
  });

  it('sorts the hand by suit or by strength, on request', async () => {
    const user = userEvent.setup();
    renderApp();
    const codes = () =>
      Array.from(document.querySelectorAll('.seat--me .hand .card img')).map((img) =>
        img.getAttribute('alt'),
      );
    const bySuit = codes();

    const panel = await openMenu(user, SETUP);
    await user.click(within(panel).getByRole('button', { name: 'Podľa sily' }));
    const byPower = codes();

    expect(byPower).toHaveLength(bySuit.length);
    expect([...byPower].sort()).toEqual([...bySuit].sort());
    expect(JSON.parse(localStorage.getItem('duren.settings')!)).toMatchObject({ sortBy: 'power' });
  });

  it('stops shading the unplayable cards when hints are off', async () => {
    const user = userEvent.setup();
    renderApp();
    const muted = () => document.querySelectorAll('.seat--me .hand .card--muted').length;

    const panel = await openMenu(user, SETUP);
    await user.click(within(panel).getByLabelText(/Nápoveda ťahu/));
    expect(muted()).toBe(0);

    await user.click(within(panel).getByLabelText(/Nápoveda ťahu/));
    expect(JSON.parse(localStorage.getItem('duren.settings')!)).toMatchObject({ hints: true });
  });

  it('offers a second deck and draws the table with it', async () => {
    const user = userEvent.setup();
    renderApp();
    const srcOf = () =>
      document.querySelector('.seat--me .hand .card img')!.getAttribute('src');
    const before = srcOf();

    const panel = await openMenu(user, SETUP);
    await user.click(within(panel).getByRole('button', { name: 'Minimal' }));
    expect(srcOf()).not.toBe(before);
    // The cards are still named the same: a Q is a Q in either deck.
    expect(
      Array.from(document.querySelectorAll('.seat--me .hand .card img')).every((img) =>
        /^[2-9TJQKA][CDHS]$/.test(img.getAttribute('alt') ?? ''),
      ),
    ).toBe(true);
  });

  it('switches skin and theme, and remembers both', async () => {
    const user = userEvent.setup();
    renderApp();
    const panel = await openMenu(user, SETUP);

    await user.click(within(panel).getByRole('button', { name: 'Klasik' }));
    await user.click(within(panel).getByRole('button', { name: 'Nočný' }));

    const app = document.querySelector('.app')!;
    expect(app.getAttribute('data-skin')).toBe('classic');
    expect(app.getAttribute('data-theme')).toBe('dark');
    expect(JSON.parse(localStorage.getItem('duren.settings')!)).toMatchObject({
      skin: 'classic',
      theme: 'dark',
    });
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
    expect(JSON.parse(localStorage.getItem('duren.settings')!)).toMatchObject({
      holdForThrowIn: true,
    });
  }, 30_000);
});

describe('table layout', () => {
  it('puts the settings behind one header button, not two panels', async () => {
    const user = userEvent.setup();
    renderApp();
    // Setup and preferences share a single drawer: hunting through two of them
    // for "the settings" is one fold-out too many.
    const panel = await openMenu(user, SETUP);
    expect(document.querySelectorAll('.menu')).toHaveLength(1);
    expect(within(panel).getByLabelText('Pauza botov')).toBeTruthy();
    expect(within(panel).getByLabelText('Hráčov')).toBeTruthy();
  });

  it('deals the draw pile beside the cards in play, clear of every chair', () => {
    // The deck used to sit on the felt's rim, which is where the left-hand
    // player sits at three and four players. On one centred row with the pile
    // it cannot collide with a chair at any table size.
    renderApp();
    const pile = document.querySelector('.felt__pile')!;
    const deck = pile.querySelector('.felt__deck');
    const table = pile.querySelector('.table');
    expect(deck).not.toBeNull();
    // To the left of the cards being played, not on top of them.
    expect(Array.from(pile.children).indexOf(deck!)).toBeLessThan(
      Array.from(pile.children).indexOf(table!),
    );

    // Chairs ring the felt; none of them drops into the band the tray owns.
    const tops = Array.from(document.querySelectorAll<HTMLElement>('.seat--across')).map((el) =>
      Number.parseFloat(el.style.top),
    );
    expect(tops.length).toBeGreaterThan(0);
    for (const top of tops) expect(top).toBeLessThan(70);
  });

  it('keeps the trump beside your name and off the table', async () => {
    const user = userEvent.setup();
    renderApp();

    // The felt used to repeat the deck and discard counts that the pile itself
    // already shows. Only the trump is left, and it sits with your name.
    expect(document.querySelector('.felt__centre .board__status')).toBeNull();
    const status = document.querySelector('.seat--me .board__status');
    expect(status, 'the trump belongs beside your name').not.toBeNull();
    expect(status!.textContent).toContain('Tromf');

    const panel = await openMenu(user, SETUP);
    await user.click(within(panel).getByLabelText(/Zobraziť údaje o hre/));
    expect(document.querySelector('.board__status')).toBeNull();
  });

  it('says who you are and what you are doing exactly once', async () => {
    const user = userEvent.setup();
    await renderHotSeat(user);
    const mine = document.querySelector('.seat--me')!;
    // Name, role and card count used to be printed twice — once on the chair
    // and once on a separate turn indicator saying the same thing.
    expect(mine.querySelectorAll('.seat__name')).toHaveLength(1);
    expect(mine.querySelectorAll('.seat__roles')).toHaveLength(1);
    expect(mine.querySelectorAll('.seat__count')).toHaveLength(1);
  });

  it('shows the job of each chair as a pictogram, and nothing when idle', async () => {
    const user = userEvent.setup();
    await renderHotSeat(user);

    const roleOf = (name: string): string | null =>
      screen.getByRole('region', { name }).querySelector('.seat__icon title')?.textContent ?? null;

    // Exactly one attacker and one defender at a two-handed table.
    const roles = ['Hráč 1', 'Hráč 2'].map(roleOf);
    expect(roles.filter((r) => r === 'útočí')).toHaveLength(1);
    expect(roles.filter((r) => r === 'bráni')).toHaveLength(1);
  });

  it('centres the deck count on the top card, not the middle of the stack', () => {
    renderApp();
    const badge = document.querySelector<HTMLElement>('.deck__count')!;
    // The pile leans up and to the right as it thickens; a badge pinned to the
    // block's centre would sit off the card it is labelling.
    expect(badge.style.translate).toContain('+ 6px');
    expect(badge.style.translate).toContain('- 6px');
  });

  it('gives your own hand the biggest cards on the table', () => {
    renderApp();
    expect(document.querySelectorAll('.seat--me .hand .card--lg').length).toBe(6);
    // Opponents are fanned small; they are information, not targets.
    expect(document.querySelectorAll('.seat--across .hand .card--sm').length).toBeGreaterThan(0);
  });
});
