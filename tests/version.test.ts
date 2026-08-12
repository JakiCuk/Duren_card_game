import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_VERSION, PROTOCOL_VERSION } from '../src/shared/version.js';
import { STAMP_PATTERN, stampFor } from '../tools/stamp-version.js';

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');

describe('the release stamp', () => {
  it('is a date and a time, not a counter', () => {
    expect(APP_VERSION).toMatch(STAMP_PATTERN);
  });

  it('agrees with package.json', () => {
    // Two files holding the same number is two chances to forget one, which is
    // the whole reason `pnpm stamp` writes both.
    const pkg = JSON.parse(read('package.json')) as { version: string };
    expect(pkg.version).toBe(APP_VERSION);
  });

  it('reads as the moment it was cut', () => {
    const stamped = stampFor(new Date(2026, 6, 31, 13, 30));
    expect(stamped).toBe('20260731.1330');
  });

  it('pads every field, so the strings sort chronologically', () => {
    // Without padding, 20260101.930 would sort after 20260101.1030.
    expect(stampFor(new Date(2026, 0, 2, 9, 5))).toBe('20260102.0905');
    const early = stampFor(new Date(2026, 0, 2, 9, 5));
    const late = stampFor(new Date(2026, 0, 2, 10, 30));
    expect([late, early].sort()).toEqual([early, late]);
  });

  it('leaves the wire protocol alone', () => {
    // The protocol version guards compatibility between a tab and a room; it
    // must not move just because a release was cut.
    expect(PROTOCOL_VERSION).toBe(1);
  });
});
