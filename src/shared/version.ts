/**
 * Bumped whenever the wire protocol changes shape. The server refuses a
 * `hello` from a mismatched major so a stale tab cannot desync a live room.
 */
export const PROTOCOL_VERSION = 1;

/**
 * The release stamp, `YYYYMMDD.HHMM`, written by `pnpm stamp` and committed.
 *
 * Client and server share it deliberately: the footer of a browser tab and the
 * `/healthz` of a deployment then print the same string, so "is what I am
 * looking at what I deployed?" is a comparison rather than an investigation.
 */
export const APP_VERSION = '20260813.0255';
