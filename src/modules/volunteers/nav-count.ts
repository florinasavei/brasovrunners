import type { Database } from "@/db/types";
import { countVolunteersForTab, type VolunteerTabCounts } from "./admin-list";

/** A minute: the registrations badge's own memo (`registrations/nav-count.ts`). */
const CACHE_MS = 60_000;
let cached: { at: number; value: VolunteerTabCounts } | null = null;

/**
 * The «Voluntari» tab's figures (`countVolunteersForTab`): everyone still in at the events ahead, and how many of them the
 * organizers have to confirm or place — memoized a minute per process, so the badge costs about one indexed count a minute
 * rather than one per page view (the club's database bills compute time, §68). `null` when the database cannot be read: the
 * tab then shows no number.
 */
export async function volunteersBadgeCount<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<VolunteerTabCounts | null> {
  if (cached && now.getTime() - cached.at < CACHE_MS) return cached.value;
  try {
    const value = await countVolunteersForTab(db, now);
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
