import { unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db/client";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Locale } from "@/i18n/routing";
import { isDatabaseAwayError } from "@/modules/resilience/domain/database-away";
import { env } from "@/shared/config/env";
import { mayViewMembersOnlyEvents } from "./domain/members-only";
import { findPublishedEventBySlug, listMembersOnlyEvents } from "./repository";

/**
 * The door to the club's events for its members alone (§552): the one place a request asks
 * "is a members' session reading this" before a members' event is read.
 *
 * The public reads never meet such an event — `publishedAnyDateIn` withholds it in SQL — so every
 * surface reads the public row first, through the public cache as before, and only when that finds
 * nothing does it come here: the account (`getCurrentAccount`, §524) is read, and a members' event
 * is read **live**, never through the public cache (§333) or a last good copy (§281), both of which
 * are shared by every visitor. Nobody signed in, an account that is not the club's, or a deployment
 * with no sign-in at all (`STAFF_AUTH_MODE=disabled`): nothing, and the caller answers its 404.
 */

/**
 * The account reading this request, when it may see the members' events — or null. Once per request
 * (`cache`): the page's metadata and its body both ask. A database that is away reads as nobody:
 * the public copy the page fell back to is what it shows, and a members' event is simply not there.
 */
export const membersViewer = cache(async (): Promise<StaffUser | null> => {
  if (env.STAFF_AUTH_MODE === "disabled") return null;
  try {
    /*
      The session module, loaded only when a request actually asks: every public form and page that
      imports this door reads a public event first and never gets here, so none of them loads the
      sign-in's provider (Auth.js) just for importing it.
    */
    const { getCurrentAccount } = await import("@/modules/staff-identity/session");
    const account = await getCurrentAccount();
    return account && mayViewMembersOnlyEvents(account.role) ? account : null;
  } catch (error) {
    unstable_rethrow(error);
    if (isDatabaseAwayError(error)) return null;
    throw error;
  }
});

/**
 * A published event by its slug for a members' session (§552) — any published event, the members'
 * own included — or undefined for anybody else. Live, never cached. Once per request per slug.
 */
export const membersEventBySlug = cache(async (locale: Locale, slug: string) => {
  const viewer = await membersViewer();
  if (!viewer) return undefined;
  const event = await findPublishedEventBySlug(getDb(), locale, slug, "members");
  // Only what the public read could not give: a public event is the public cache's to serve.
  return event?.membersOnly ? event : undefined;
});

/** The members' events for the zone (§552), or none for a viewer who may not see them. */
export async function membersOnlyEventsFor(viewer: Pick<StaffUser, "role"> | null, locale: Locale, now: Date) {
  if (!viewer || !mayViewMembersOnlyEvents(viewer.role)) return [];
  return listMembersOnlyEvents(getDb(), locale, now);
}
