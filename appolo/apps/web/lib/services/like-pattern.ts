/**
 * Helpers for turning user input into a literal `LIKE`/`ILIKE` pattern.
 *
 * A raw `%${query}%` lets a visitor send `%` or `_` and turn an anchored search
 * into "match everything", which ignores indexes and can return unrelated rows.
 * Postgres treats backslash as the default escape character, so escaping `\`,
 * `%` and `_` makes the pattern literal without needing an ESCAPE clause.
 */

/** Escape the three characters that carry meaning inside a LIKE pattern. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** `%value%` — matches the value anywhere. */
export function likeContains(value: string): string {
  return `%${escapeLike(value)}%`;
}

/** `value%` — matches values that start with the input. */
export function likePrefix(value: string): string {
  return `${escapeLike(value)}%`;
}
