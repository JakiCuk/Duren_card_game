/**
 * Converts a downloaded card set into the project's asset convention.
 *
 * Run once per theme; the output is committed. Kept in the repo so the import
 * is reproducible and auditable rather than a pile of files somebody once
 * dropped in.
 *
 *   curl -LO https://www.tekeye.uk/downloads/svg_playing_cards.zip
 *   unzip svg_playing_cards.zip -d /tmp/cards
 *   pnpm tsx tools/import-cards.ts /tmp/cards/svg_playing_cards --theme classic
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { optimize } from 'svgo';

const RANKS: Record<string, string> = {
  '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  '10': 'T', jack: 'J', queen: 'Q', king: 'K', ace: 'A',
};
const SUITS: Record<string, string> = { clubs: 'C', diamonds: 'D', hearts: 'H', spades: 'S' };

const PROVENANCE =
  '<!-- SVG Playing Cards by Daniel S. Fowler (https://tekeye.uk), CC0 1.0 / Public Domain. See ASSETS.md. -->';

/**
 * The source cards declare width/height but no viewBox, so they would not scale
 * with their container. Promote the declared size to a viewBox and drop the
 * fixed dimensions, which is what makes CSS sizing possible at all.
 */
function ensureViewBox(svg: string, file: string): string {
  const open = /<svg\b[^>]*>/.exec(svg);
  if (!open) throw new Error(`${file}: no <svg> element`);
  let tag = open[0];
  if (!/\bviewBox=/.test(tag)) {
    const w = /\bwidth="([\d.]+)(?:px)?"/.exec(tag)?.[1];
    const h = /\bheight="([\d.]+)(?:px)?"/.exec(tag)?.[1];
    if (w === undefined || h === undefined) throw new Error(`${file}: neither viewBox nor width/height`);
    tag = tag.replace(/<svg\b/, `<svg viewBox="0 0 ${w} ${h}"`);
  }
  tag = tag.replace(/\s(width|height)="[^"]*"/g, '');
  return svg.slice(0, open.index) + tag + svg.slice(open.index + open[0].length);
}

function convert(svg: string, file: string): string {
  // svgo 4's default preset preserves viewBox, which is the whole point of the
  // rewrite above; a test asserts every shipped card still has one.
  const { data } = optimize(ensureViewBox(svg, file), {
    multipass: true,
    plugins: ['preset-default'],
  });
  return `${PROVENANCE}\n${data}\n`;
}

function main(argv: string[]): void {
  const source = argv[0];
  if (source === undefined) {
    throw new Error('Usage: import-cards.ts <source-dir> [--theme name] [--back file] [--out dir]');
  }
  const theme = argv[argv.indexOf('--theme') + 1] ?? 'classic';
  const backName = argv.includes('--back') ? argv[argv.indexOf('--back') + 1]! : 'blue.svg';

  const frontsDir = join(resolve(source), 'fronts');
  const backsDir = join(resolve(source), 'backs');
  const outRoot = argv.includes('--out') ? argv[argv.indexOf('--out') + 1]! : 'src/client/cards/decks';
  const outDir = resolve(outRoot, theme);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  let written = 0;
  let sourceBytes = 0;
  let outBytes = 0;
  const produced = new Set<string>();

  for (const file of readdirSync(frontsDir)) {
    if (!file.endsWith('.svg')) continue;
    const [suit, value] = basename(file, '.svg').split('_');
    const rank = value === undefined ? undefined : RANKS[value];
    const suitCode = suit === undefined ? undefined : SUITS[suit];
    if (rank === undefined || suitCode === undefined) continue; // jokers, blanks, variants

    const raw = readFileSync(join(frontsDir, file), 'utf8');
    const out = convert(raw, file);
    const code = `${rank}${suitCode}`;
    if (produced.has(code)) throw new Error(`Two sources map to ${code}`);
    produced.add(code);
    writeFileSync(join(outDir, `${code}.svg`), out);
    sourceBytes += raw.length;
    outBytes += out.length;
    written++;
  }

  const backRaw = readFileSync(join(backsDir, backName), 'utf8');
  writeFileSync(join(outDir, 'back.svg'), convert(backRaw, backName));

  if (written !== 52) throw new Error(`Expected 52 cards, wrote ${written}`);
  console.log(
    `theme "${theme}": 52 cards + back → ${outDir}\n` +
      `  ${(sourceBytes / 1024).toFixed(0)} KB → ${(outBytes / 1024).toFixed(0)} KB ` +
      `(${(100 - (100 * outBytes) / sourceBytes).toFixed(0)} % smaller)`,
  );
}

main(process.argv.slice(2).filter((a) => a !== '--'));
