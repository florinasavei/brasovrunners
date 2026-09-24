/**
 * Whether a string is shaped like a value the `uuid` columns in `src/db/schema/*.ts` accept
 * (found during the dev-SSR investigation, §376): every admin `/…/[id]` route passed its
 * `params.id` straight into a `WHERE id = $1` against such a column, so a typed or malformed
 * address — `/admin/events/nope`, a stray space, a truncated id — reached PostgreSQL, which
 * refuses the value with `invalid input syntax for type uuid` and turned into a 500 rather than
 * the 404 every other unknown id on these pages already answers with.
 *
 * The check is the RFC 4122 textual shape PostgreSQL's `uuid` type itself accepts: 32 hex
 * digits grouped `8-4-4-4-12`, case-insensitive (Postgres normalises to lower case on write, so
 * an upper-case id already in the database — typed into a URL by hand, or pasted from
 * somewhere that upper-cased it — still resolves). Nothing here asks the database; a shape that
 * passes may still name no row, which is `notFound()` exactly as it always was.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
