/**
 * Keyset (cursor) pagination helpers.
 *
 * A cursor is the sort key of the LAST row of the previous page, serialized as
 * an opaque base64url string. The next page is "rows after that key", so it
 * stays stable when rows are inserted meanwhile (unlike OFFSET) and costs the
 * same on page 1 and page 1000 when the sort key is indexed.
 *
 * The sort key is always (timestamp, id): the id breaks ties between rows that
 * share a timestamp, so no row is skipped or repeated at a page boundary.
 *
 * PRECISION: Postgres timestamps have microseconds, a JS Date only
 * milliseconds. A cursor built from a Date can skip rows at a page boundary,
 * so the timestamp travels as TEXT formatted by Postgres (see cursorTsSql) and
 * is compared back as ::timestamptz, never round-tripped through a Date.
 */
import { DatabaseService } from '../../database/database.service';
export interface CursorPage<T> {
  items: T[];
  /** Pass back as `cursor` for the next page; null when this is the last page. */
  nextCursor: string | null;
}

export interface CursorKey {
  /** Postgres-formatted UTC timestamp with microseconds (see cursorTsSql). */
  t: string;
  /** Id of the last row (tiebreaker). */
  id: string;
}

export interface PageOptions {
  limit?: number;
  /** The nextCursor of the previous page. Omit for the first page. */
  cursor?: string;
}

/** Thrown for a malformed or tampered cursor: map it to a 400. */
export class InvalidCursorError extends Error {
  constructor() {
    super('Invalid pagination cursor');
    this.name = 'InvalidCursorError';
  }
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
export const CURSOR_COLUMN = 'cursor_t';

const TS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function clampLimit(limit: number | undefined): number {
  const n = Math.trunc(limit ?? DEFAULT_PAGE_SIZE);
  return Number.isFinite(n) && n > 0
    ? Math.min(n, MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
}

/** SQL expression that renders a timestamptz column as the cursor's text form. */
export function cursorTsSql(expr: string): string {
  return `to_char((${expr}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

/**
 * Decodes and strictly validates a cursor. Both parts are checked against a
 * pattern because they are bound into SQL casts: a tampered value must be a
 * clean 400, not a Postgres cast error.
 */
export function decodeCursor(cursor: string): CursorKey {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (typeof parsed === 'object' && parsed !== null) {
      const { t, id } = parsed as Partial<CursorKey>;
      if (
        typeof t === 'string' &&
        typeof id === 'string' &&
        TS_PATTERN.test(t) &&
        UUID_PATTERN.test(id)
      ) {
        return { t, id };
      }
    }
  } catch {
    // fall through
  }
  throw new InvalidCursorError();
}

/**
 * Builds the keyset predicate for the next page and appends its two params.
 * Returns '' for the first page. `dir` is '<' when sorting DESC, '>' for ASC.
 * The predicate is a row-value comparison so Postgres can use an index range.
 */
export function keysetPredicate(
  cursor: string | undefined,
  params: unknown[],
  tsExpr: string,
  idExpr: string,
  dir: '<' | '>',
): string {
  if (!cursor) return '';
  const key = decodeCursor(cursor);
  params.push(key.t, key.id);
  const t = params.length - 1;
  const id = params.length;
  return `AND (${tsExpr}, ${idExpr}) ${dir} ($${t}::timestamptz, $${id}::uuid)`;
}

/**
 * Queries fetch limit + 1 rows. This trims the look-ahead row and builds the
 * next cursor from the last row that is kept.
 */
export function toPage<T>(
  rows: T[],
  limit: number,
  keyOf: (row: T) => CursorKey,
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(keyOf(last)) : null,
  };
}

/** Removes the helper cursor column so it never leaks into an entity. */
export function stripCursorColumn<T extends { cursor_t: string }>(
  row: T,
): Omit<T, 'cursor_t'> {
  const copy: Record<string, unknown> = { ...row };
  delete copy[CURSOR_COLUMN];
  return copy as Omit<T, 'cursor_t'>;
}

/**
 * DatabaseService.query types rows as `any`. Pin them to a row type once, here,
 * so callers never touch an `any` (no-unsafe-* lint rules). This is a type
 * assertion, not validation: T must match the columns the SQL returns.
 */
export async function queryRows<T>(
  db: DatabaseService,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const result = await db.query(sql, params);
  return result.rows as T[];
}
