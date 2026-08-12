/**
 * Draws the "minimal" deck: a rank in the corner, one large suit in the middle.
 *
 * It exists because the Claude Design mock offered a drawn alternative to the
 * photographic Tek Eye faces, and a second deck is the cheapest way to prove the
 * theme seam actually holds — the game names a `CardId` and never a file.
 *
 * Ranks keep their usual letters (J, Q, K, A), not the Slovak D for dáma: both
 * decks must name the same card the same way, or the two would disagree about
 * what you are holding.
 *
 * Run with: pnpm tsx tools/make-minimal-deck.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/client/cards/decks/minimal');

/** Same box as the classic deck, so swapping themes never moves the layout. */
const W = 234;
const H = 333;

const RED = '#c1121f';
const BLACK = '#1a1a1a';
const PAPER = '#fffdf9';
const EDGE = '#d9d3c7';

/**
 * Each suit drawn inside a 100×100 box, so one set of numbers places it at any
 * size. Clubs are three discs and a stem rather than one clever path: the shape
 * is instantly recognisable and the arithmetic is checkable by eye.
 */
const SUIT_ART: Record<string, string> = {
  S:
    '<path d="M50 6C50 6 92 40 92 64c0 15-11 24-22 24-8 0-15-4-20-11-5 7-12 11-20 11-11 0-22-9-22-24C8 40 50 6 50 6Z"/>' +
    '<path d="M44 74h12c0 11 4 20 9 24H35c5-4 9-13 9-24Z"/>',
  H: '<path d="M50 94S8 62 8 36C8 20 20 8 33 8c9 0 15 5 17 11 2-6 8-11 17-11 13 0 25 12 25 28 0 26-42 58-42 58Z"/>',
  D: '<path d="M50 4 90 50 50 96 10 50Z"/>',
  C:
    '<circle cx="50" cy="30" r="20"/><circle cx="26" cy="62" r="20"/><circle cx="74" cy="62" r="20"/>' +
    '<path d="M43 66h14l8 30H35Z"/>',
};

const SUIT_NAME: Record<string, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const label = (rank: string): string => (rank === 'T' ? '10' : rank);

/** Places the suit art at a given corner of the card, at a given size. */
const suitAt = (suit: string, x: number, y: number, size: number, fill: string): string =>
  `<g fill="${fill}" transform="translate(${x} ${y}) scale(${(size / 100).toFixed(4)})">${SUIT_ART[suit]}</g>`;

function corner(rank: string, suit: string, ink: string): string {
  const text = label(rank);
  // "10" needs to fit the same column as a single glyph, so it is squeezed
  // rather than allowed to run into the card's edge.
  const size = text.length > 1 ? 40 : 50;
  return (
    `<text x="34" y="58" font-family="Arial, Helvetica, sans-serif" font-size="${size}" ` +
    `font-weight="700" text-anchor="middle" fill="${ink}">${text}</text>` +
    suitAt(suit, 21, 70, 26, ink)
  );
}

function cardSvg(rank: string, suit: string): string {
  const ink = suit === 'H' || suit === 'D' ? RED : BLACK;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">`,
    `<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="18" fill="${PAPER}" stroke="${EDGE}" stroke-width="3"/>`,
    corner(rank, suit, ink),
    `<g transform="rotate(180 ${W / 2} ${H / 2})">${corner(rank, suit, ink)}</g>`,
    // 96, not 116: a bigger glyph reaches the rotated corner index and the two
    // start touching, which reads as a printing fault rather than a design.
    suitAt(suit, (W - 96) / 2, (H - 96) / 2, 96, ink),
    '</svg>',
  ].join('');
}

/**
 * The lattice is drawn as explicit lines rather than an SVG `<pattern>`.
 *
 * Patterns are the tidier markup, but the file also has to survive being handed
 * to whatever rasteriser someone points at it, and pattern support is the first
 * thing those drop. Forty line elements always draw.
 */
function lattice(): string {
  const lines: string[] = [];
  for (let offset = -H; offset < W + H; offset += 24) {
    lines.push(`M${offset} 0 L${offset + H} ${H}`);
    lines.push(`M${offset} ${H} L${offset + H} 0`);
  }
  return `<path d="${lines.join(' ')}" stroke="#5b7fae" stroke-width="2" fill="none" opacity="0.5"/>`;
}

const backSvg = (): string =>
  [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">`,
    `<defs><clipPath id="inner"><rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="10"/></clipPath></defs>`,
    `<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="18" fill="#243447" stroke="${EDGE}" stroke-width="3"/>`,
    `<g clip-path="url(#inner)">${lattice()}</g>`,
    `<rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="10" fill="none" stroke="#8fb0d8" stroke-width="3"/>`,
    `<circle cx="${W / 2}" cy="${H / 2}" r="54" fill="#243447" stroke="#8fb0d8" stroke-width="3"/>`,
    `<g fill="#8fb0d8" transform="translate(${W / 2 - 31} ${H / 2 - 31}) scale(0.62)">${SUIT_ART['S']}</g>`,
    '</svg>',
  ].join('');

mkdirSync(OUT, { recursive: true });
let written = 0;
for (const suit of Object.keys(SUIT_ART)) {
  for (const rank of RANKS) {
    writeFileSync(join(OUT, `${rank}${suit}.svg`), cardSvg(rank, suit));
    written++;
  }
}
writeFileSync(join(OUT, 'back.svg'), backSvg());
written++;

console.log(`wrote ${written} files to ${OUT} (${Object.values(SUIT_NAME).join(', ')})`);
