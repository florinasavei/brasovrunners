import { isUuid } from "@/shared/ids";
import { PLACES_TAKEN_KEYS } from "./capacity";

/**
 * Where one registration's row stands on the registrations list (§NNN): the `id` of its row in the wide
 * table (`AdminTable`'s `rowId`) and the fragment a row's own press comes back to.
 *
 * The owner, 2026-11-12: «Mă disperă în general că atunci când fac un edit gen „aleg partenerul” și navighezi».
 * Every press of a row answered at `#admin-alert`, the top of a page whose table starts several screens
 * down: a partner chosen on the thirtieth row and the list was gone from under the hand. The outcome is the
 * toast's to say (`flashOutcome`), so a press that went through comes back to the row it changed; a refusal
 * still lands on the alert, which is where its sentence is. The shop's orders do the same (§847).
 */
export function registrationRowAnchor(registrationId: string): string {
  return `reg-${registrationId}`;
}

/**
 * The fragment of a row press's redirect: the row when the press went through and names a registration,
 * the page's alert otherwise — a refusal, a press on many rows, an id that is not one.
 */
export function listReturnAnchor(outcome: Readonly<Record<string, string | undefined>>, registrationId?: string): string {
  if (outcome.error !== undefined || !registrationId || !isUuid(registrationId)) return "admin-alert";
  return registrationRowAnchor(registrationId.toLowerCase());
}

/**
 * What a press on the list drops from the list's own query before it writes its outcome: the keys that would
 * reopen a panel or say an older outcome again.
 */
const SPENT_KEYS: readonly string[] = ["erase", "memberSweep", "error", "saved", "count", "cancelled", "erased", "failed", "test", "voided", "from", "resent", ...PLACES_TAKEN_KEYS];

/**
 * The address a press on the list comes back to (§NNN, §180's shape): the list's path, rebuilt by the caller and
 * never read from the form, its own query with the outcome in it, and `listReturnAnchor`'s fragment. Only the query
 * travels in a field, so the field chooses which rows come back and never where the browser goes.
 */
export function listReturnHref(listPath: string, listQuery: string, outcome: Readonly<Record<string, string>>, registrationId?: string): string {
  const params = new URLSearchParams(listQuery);
  for (const key of SPENT_KEYS) params.delete(key);
  for (const [key, value] of Object.entries(outcome)) params.set(key, value);
  return `${listPath}?${params.toString()}#${listReturnAnchor(outcome, registrationId)}`;
}
