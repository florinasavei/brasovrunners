/**
 * The memory that keeps a filter panel open across the tick that remounts its page (§549, §NNN).
 *
 * A tick says the panel was open; it is written down here, in a module a soft navigation keeps, with
 * the scope that was ticked and the address the tick goes to, and the next mount of that scope's panel
 * on that address opens it again, once. The address makes the memory self-expiring: a panel that no
 * longer renders after its own tick leaves a note nobody takes, and a later mount of the same scope on
 * any other address — a shared link, the back button — finds a note about a different page and ignores
 * it. It is also dropped once it is old, whatever the address says.
 */
let remembered: { scope: string; to: string; at: number } | null = null;

/** A tick that has not landed in this long is not coming. */
export const REOPEN_WINDOW_MS = 10_000;

/** A tick of `scope`'s panel is about to navigate to `to` (a path and its query). */
export function rememberTick(scope: string, to: string, now: number = Date.now()): void {
  remembered = { scope, to, at: now };
}

/** Whether the panel of `scope`, mounted on `current` (path and query), is the one that was ticked. */
export function wasTicked(scope: string, current: string, now: number = Date.now()): boolean {
  return remembered !== null && remembered.scope === scope && remembered.to === current && now - remembered.at < REOPEN_WINDOW_MS;
}

/** Forget the tick: the page that answers it has committed. */
export function spendTick(): void {
  remembered = null;
}
