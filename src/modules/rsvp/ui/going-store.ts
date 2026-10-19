/**
 * Whether THIS browser has answered «Vin!» to an event, as the island learned it (§812): the one thing the closed «Vii?» fold's line
 * needs from `RsvpRemembered` and cannot get any other way — the event page is static and the same for everybody (§549), so the line
 * the server draws never says «Tu vii ✓». A few lines of module state read through `useSyncExternalStore`, rather than a context,
 * because the island and the line sit in different parts of the same fold and the Server Component between them cannot carry a provider.
 *
 * Keyed by the event's slug, so a client-side navigation to another event never shows the previous one's answer. No secret and no address:
 * a boolean per page, gone with the tab.
 */
const going = new Map<string, boolean>();
const listeners = new Set<() => void>();

/** Called by the island whenever its state read or its press says where this browser stands. */
export function setRsvpGoing(slug: string, value: boolean): void {
  if ((going.get(slug) ?? false) === value) return;
  going.set(slug, value);
  for (const notify of listeners) notify();
}

export function subscribeRsvpGoing(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

export function readRsvpGoing(slug: string): boolean {
  return going.get(slug) ?? false;
}
