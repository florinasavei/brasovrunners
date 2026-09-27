/**
 * «Adaugă mai mulți membri» (§524): the rows an Administrator pastes, one person per row.
 *
 * A row is an address, or a name and an address — "Ana Pop, ana@…", "Ana Pop <ana@…>", a tab from a
 * spreadsheet's two columns, or a semicolon. The address is the row's entry that holds an "@"; the
 * rest, trimmed, is the name. A row with no name is named by its address's local part, which the
 * member may change nowhere and the Administrator may rename later — the allowlist needs a name,
 * the club's list of members usually has one.
 *
 * Pure: no database, no role. The service validates every row before it inserts any (the whole
 * batch or nothing, §457's rule for a list of addresses), and the action names the rows that are not
 * addresses through §457's `INVALID_ADDRESSES`.
 */

/** One person the rows name. `email` is as typed (trimmed); the service lowercases it. */
export type MemberRow = { email: string; displayName: string };

/**
 * How many rows one press may add (§524): each is a sign-in account at the provider, made after the
 * transaction inside the same request, so a longer list is pasted in several presses.
 */
export const MEMBER_ROWS_MAX = 50;

const SEPARATORS = /[,;\t<>]+/;

/** One row as a person, or its typed text when no entry in it holds an "@" (then `email` is the text). */
function rowOf(line: string): MemberRow {
  const parts = line
    .split(SEPARATORS)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const at = parts.findIndex((part) => part.includes("@"));
  if (at === -1) return { email: line.trim(), displayName: "" };
  const email = parts[at];
  const name = parts
    .filter((_, index) => index !== at)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/^"|"$/g, "")
    .trim();
  return { email, displayName: name || email.split("@")[0] };
}

/**
 * The textarea's rows as people, blank rows dropped. An address typed twice is kept once — the
 * same person pasted from two lists is not a refusal — compared lowercased, as the allowlist is.
 */
export function parseMemberRows(text: string): MemberRow[] {
  const rows: MemberRow[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const row = rowOf(line);
    const key = row.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows;
}
