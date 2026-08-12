/**
 * Stamps the release version: `YYYYMMDD.HHMM`, local time.
 *
 * A date is a better version than a counter for something deployed rather than
 * depended on. Nobody installs this package, so a semver number would only
 * encode how many times somebody remembered to bump it; a stamp answers the
 * question anyone actually has when looking at a running table — "is this the
 * build I deployed, or the one from last week?".
 *
 * Stamping is a deliberate act and its result is committed, not generated
 * during `pnpm build`. A version baked in at build time differs between the
 * client bundle, the server bundle and the Docker image, and then the number in
 * the footer no longer identifies anything you can check out.
 *
 * Run with: pnpm stamp
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** `YYYYMMDD.HHMM` — the shape the rest of the project matches against. */
export const STAMP_PATTERN = /^\d{8}\.\d{4}$/;

export function stampFor(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  return `${date}.${pad(now.getHours())}${pad(now.getMinutes())}`;
}

/** Rewrites the one line that holds a version, leaving the file's shape alone. */
function replaceIn(path: string, pattern: RegExp, next: string): string {
  const file = join(ROOT, path);
  const before = readFileSync(file, 'utf8');
  const after = before.replace(pattern, next);
  if (after === before && !pattern.test(before)) {
    throw new Error(`Could not find a version to stamp in ${path}`);
  }
  writeFileSync(file, after);
  return path;
}

export function stamp(version: string): string[] {
  return [
    replaceIn('package.json', /("version":\s*)"[^"]*"/, `$1"${version}"`),
    replaceIn('src/shared/version.ts', /(APP_VERSION = )'[^']*'/, `$1'${version}'`),
  ];
}

// Only when run directly, so the pattern and helpers can be imported by tests.
if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const version = stampFor(new Date());
  const touched = stamp(version);
  console.log(`stamped ${version} in ${touched.join(', ')}`);
}
