import { z } from 'zod';
import type { GameResult, Move, PlayerView, PublicEvent, Seat } from '../engine/index.js';
import { MAX_PLAYERS, type RuleConfig } from './rules.js';

/**
 * The wire contract. Zod schemas are the single source of truth and the
 * TypeScript types are inferred from them, so a message that type-checks is a
 * message the server will actually accept.
 */

export const LOCALES = ['sk', 'uk', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

const seat = z.number().int().min(0).max(MAX_PLAYERS - 1);
const card = z.number().int().min(0).max(51);
const botLevel = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export const moveSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('ATTACK'), seat, card }),
  z.object({ t: z.literal('DEFEND'), seat, card, slot: z.number().int().min(0).max(11) }),
  z.object({ t: z.literal('TRANSFER'), seat, card, reveal: z.boolean() }),
  z.object({ t: z.literal('TAKE'), seat }),
  z.object({ t: z.literal('PASS'), seat }),
]);

export const ruleConfigSchema = z.object({
  deckSize: z.union([z.literal(36), z.literal(52)]),
  handSize: z.number().int().min(2).max(8),
  maxTableSlots: z.number().int().min(1).max(12),
  attackCap: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('fixed'), n: z.number().int().min(1).max(12) }),
    z.object({ kind: z.literal('defenderHand') }),
    z.object({ kind: z.literal('unlimited') }),
  ]),
  throwInAfterTakeCap: z.enum(['sameAsAttack', 'defenderHandAtBoutStart', 'unlimited']),
  firstBoutCapFive: z.boolean(),
  throwInAfterTake: z.boolean(),
  attackerScope: z.enum(['all', 'neighbours']),
  transfer: z.object({
    enabled: z.boolean(),
    withTrumpReveal: z.boolean(),
    allowChains: z.boolean(),
  }),
  firstAttacker: z.enum(['lowestTrump', 'random']),
  defenderMustBeatAll: z.boolean(),
  trumpCardVisible: z.boolean(),
});

/**
 * Compile-time proof that the schema and the engine's own type describe the
 * same shape. Without it the two drift apart silently and the server starts
 * accepting configurations the engine cannot honour.
 */
type SchemaMatchesConfig = z.infer<typeof ruleConfigSchema> extends RuleConfig
  ? RuleConfig extends z.infer<typeof ruleConfigSchema>
    ? true
    : never
  : never;
const _schemaMatchesConfig: SchemaMatchesConfig = true;
void _schemaMatchesConfig;

const playerName = z.string().trim().min(1).max(20);
const roomCode = z.string().trim().length(5);

export const c2sSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    token: z.string().max(64).optional(),
    locale: z.enum(LOCALES),
    protocol: z.number().int(),
  }),
  z.object({ t: z.literal('room.create'), name: playerName, config: ruleConfigSchema }),
  z.object({ t: z.literal('room.join'), code: roomCode, name: playerName }),
  z.object({ t: z.literal('room.leave') }),
  z.object({ t: z.literal('room.config'), config: ruleConfigSchema }),
  z.object({ t: z.literal('room.seat'), seat }),
  z.object({ t: z.literal('room.bot.add'), seat, level: botLevel }),
  z.object({ t: z.literal('room.bot.remove'), seat }),
  z.object({ t: z.literal('room.start') }),
  z.object({ t: z.literal('room.rematch') }),
  z.object({ t: z.literal('game.move'), seq: z.number().int().min(0), move: moveSchema }),
  z.object({ t: z.literal('game.resync') }),
  z.object({ t: z.literal('chat'), text: z.string().trim().min(1).max(200) }),
  z.object({ t: z.literal('ping') }),
]);

export type C2S = z.infer<typeof c2sSchema>;

export const ERROR_CODES = [
  'bad_message',
  'protocol_mismatch',
  'no_room',
  'room_not_found',
  'room_full',
  'room_in_progress',
  'server_full',
  'not_host',
  'seat_taken',
  'seat_out_of_range',
  'bad_config',
  'not_enough_players',
  'stale_seq',
  'illegal_move',
  'not_your_seat',
  'rate_limited',
  'bot_level_unavailable',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type SeatOccupant =
  | { kind: 'empty' }
  | {
      kind: 'human';
      playerId: string;
      name: string;
      connected: boolean;
      /** The server is playing this seat because nobody came back for it. */
      substituted: boolean;
    }
  | { kind: 'bot'; level: 1 | 2 | 3 | 4; name: string };

export interface RoomState {
  code: string;
  phase: 'lobby' | 'playing' | 'finished';
  hostId: string;
  config: RuleConfig;
  seats: SeatOccupant[];
  /** Present once a game has finished, so the lobby can show the outcome. */
  lastResult: GameResult | null;
  problems: { errors: string[]; warnings: string[] };
}

export interface ChatLine {
  seat: Seat | null;
  name: string;
  text: string;
  at: number;
}

export type S2C =
  | { t: 'hello.ok'; token: string; playerId: string; room: RoomState | null; protocol: number }
  | { t: 'room.state'; room: RoomState; you: Seat | null }
  | { t: 'game.view'; view: PlayerView; events: PublicEvent[] }
  | { t: 'room.closed'; reason: 'empty' | 'idle' | 'host_left' }
  | { t: 'chat'; line: ChatLine }
  | { t: 'error'; code: ErrorCode; seq?: number; detail?: string }
  | { t: 'pong' };

/** Room codes avoid I, L, O and U so nobody has to guess at a shared link. */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const normalizeCode = (raw: string): string => raw.trim().toUpperCase().replace(/\s/g, '');

export const isMove = (value: unknown): value is Move => moveSchema.safeParse(value).success;
