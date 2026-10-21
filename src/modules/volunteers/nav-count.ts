import type { Database } from "@/db/types";
import { countVolunteersAwaiting } from "./admin-list";

/** A minute: the registrations badge's own memo (`registrations/nav-count.ts`). */
const CACHE_MS = 60_000;
let cached: { at: number; value: number } | null = null;

/**
 * The «Voluntari» tab's figure (§NNN): how many offers still wait for an answer — «Înscris» on an event not yet over —
 * memoized a minute per process, so the badge costs about one indexed count a minute rather than one per page view (the
 * club's database bills compute time, §68). `null` when the database cannot be read: the tab then shows no number.
 */
export async function volunteersBadgeCount<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<number | null> {
  if (cached && now.getTime() - cached.at < CACHE_MS) return cached.value;
  try {
    const value = await countVolunteersAwaiting(db, now);
    cached = { at: now.getTime(), value };
    return value;
  } catch {
    return null;
  }
}

/** Forget the memo: for a test that writes and reads within one minute. */
export function forgetVolunteersBadgeCount(): void {
  cached = null;
}
