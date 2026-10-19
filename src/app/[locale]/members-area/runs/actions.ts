"use server";

import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { accountIdentity } from "@/modules/rsvp/domain/account-identity";
import { ZONE_RSVP_OUTCOME_ANCHOR, type ZoneRsvpOutcome, zoneRsvpAnchor } from "@/modules/rsvp/domain/zone-outcome";
import { answerRsvp, withdrawRsvp } from "@/modules/rsvp/rsvp";
import { canOpenMembersZone } from "@/modules/staff-identity/domain/roles";
import { getCurrentAccount } from "@/modules/staff-identity/session";
import { env } from "@/shared/config/env";
import { isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/**
 * The members' zone's one tap on «Alergări» (§NNN): «Vin!» and «Nu mai vin» on a run that takes answers.
 *
 * **Who answers is read here, from the session, and nowhere else** (BR-REQ-060-01): the form carries the event, the page's language
 * and the person's tick «Vreau să apar cu numele» — never an address, never a name, never a role. The door is the zone's own
 * (`canOpenMembersZone`, §524: a member and every colleague): signed out, the session ended while the page was open, and the
 * sign-in in the members' words lands back on the zone; an account that may not open the zone gets the 404 the page gives. The answer is
 * the service's (`answerRsvp`, `withdrawRsvp`) as `source: "account"` — verified, so counted at once and no email — and the service
 * asserts `rsvpOffered` again, so a stale page cannot answer for a run that has since started or stopped taking answers (§812).
 *
 * Each press ends in a redirect back to the zone with one language-neutral code (`?vin=`, `zone-outcome.ts`) and the row's own anchor,
 * as the shop's verbs do (§683): it works with JavaScript off, the page is read again live, and nothing typed travels in the address.
 */

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * The zone again, with what happened said once. At the pressed row — unless the run no longer takes answers (`closed`): its row is
 * gone, so the page lands on the sentence itself. With no outcome (nothing was taken back) the zone is simply shown again.
 */
function back(locale: Locale, outcome: ZoneRsvpOutcome | null, eventId: string): never {
  const path = getPathname({ locale, href: outcome ? { pathname: "/members-area/runs", query: { vin: outcome } } : "/members-area/runs" });
  const anchor = outcome === "closed" ? `#${ZONE_RSVP_OUTCOME_ANCHOR}` : isUuid(eventId) ? `#${zoneRsvpAnchor(eventId)}` : "";
  redirect(`${path}${anchor}`);
}

/** The service's own refusal, «the run takes no answers» (CONFLICT), is the page's sentence; anything else is a real error and surfaces. */
function closedOrThrow(error: unknown): void {
  if (!isDomainError(error) || error.code !== "CONFLICT") throw error;
}

/** The signed-in account that may open the zone — or the sign-in, or the 404 (the page's own door, asserted again by the verb). */
async function memberOrSignIn(locale: Locale) {
  // The page's door says 404 where this deployment has no sign-in (`openZone`); a forged post gets the same, not a sign-in to nowhere.
  if (env.STAFF_AUTH_MODE === "disabled") notFound();
  const account = await getCurrentAccount();
  if (!account) redirect(getPathname({ locale, href: { pathname: "/sign-in", query: { to: "members" } } }));
  if (!canOpenMembersZone(account.role)) notFound();
  return account;
}

/** «Vin!»: the account's answer, counted at once. A refusal of the service (the run takes no answers now) is «closed», never an error page. */
export async function answerAsMemberAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const account = await memberOrSignIn(locale);
  let outcome: ZoneRsvpOutcome = "closed";
  if (isUuid(eventId)) {
    try {
      await answerRsvp(getDb(), eventId, accountIdentity(account, locale, form.get("showName") === "on"), new Date());
      outcome = "went";
    } catch (error) {
      // CONFLICT: not offered (any more). VALIDATION_ERROR (an address the service cannot keep) is not «closed»: it surfaces.
      closedOrThrow(error);
    }
  }
  back(locale, outcome, eventId);
}

/** «Nu mai vin»: the account's answer taken back — never gated by the notice or the tick (a person may always take an answer back). */
export async function leaveAsMemberAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const account = await memberOrSignIn(locale);
  // «left» only when an answer was there to take back; a stale page's second press, or a malformed event, says nothing.
  let outcome: ZoneRsvpOutcome | null = null;
  if (isUuid(eventId)) {
    try {
      if (await withdrawRsvp(getDb(), { eventId, identity: accountIdentity(account, locale, false) }, new Date())) outcome = "left";
    } catch (error) {
      closedOrThrow(error);
      outcome = "closed";
    }
  }
  back(locale, outcome, eventId);
}
