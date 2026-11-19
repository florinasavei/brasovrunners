/**
 * Who marked a runner present (§NNN), the pure half of `../checked-in-by.ts`: the row's two facts — the staff account's name, joined,
 * and whether the person pressed «Am ajuns» themselves (`CHECKED_IN_BY_SELF`) — as one answer, and that answer in the chip's words.
 */
export type CheckedInBy = { kind: "staff"; name: string } | { kind: "self" } | { kind: "removed" };

export function checkedInByOf(row: { checkedInByName: string | null; checkedInBySelf: boolean }): CheckedInBy {
  if (row.checkedInByName !== null) return { kind: "staff", name: row.checkedInByName };
  return row.checkedInBySelf ? { kind: "self" } : { kind: "removed" };
}

/** The chip's `{who}`: the account's name, or the catalogue's words for the person's own press and for an account gone since. */
export function checkedInWords(by: CheckedInBy, words: { self: string; removed: string }): string {
  return by.kind === "staff" ? by.name : by.kind === "self" ? words.self : words.removed;
}
