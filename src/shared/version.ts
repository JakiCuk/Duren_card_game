/**
 * Bumped whenever the wire protocol changes shape. The server refuses a
 * `hello` from a mismatched major so a stale tab cannot desync a live room.
 */
export const PROTOCOL_VERSION = 1;

export const CLIENT_VERSION = '0.1.0';
