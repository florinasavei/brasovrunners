import type { AddressCap } from "./domain/address-cap";

/**
 * This server instance's copy of the club's registrations-per-address limit (§NNN), apart from
 * `address-cap.ts` so the test helpers can drop it between databases without importing the
 * database — the deadlines' memo, for the same reasons and with the same minute (§377): a save is
 * on the page that made it at once and on every other instance within the minute, and what that
 * minute can cost is one more (or one fewer) family member accepted under the previous number,
 * which is still a number the club chose.
 */
const MEMO_MS = 60_000;
let memo: { at: number; cap: AddressCap } | null = null;

export function memoizedAddressCap(): AddressCap | null {
  return memo && Date.now() - memo.at < MEMO_MS ? memo.cap : null;
}

export function rememberAddressCap(cap: AddressCap): void {
  memo = { at: Date.now(), cap };
}

/** Dropped on a save, and between tests that reset the database (`tests/helpers/db.ts`). */
export function forgetCachedAddressCap(): void {
  memo = null;
}
