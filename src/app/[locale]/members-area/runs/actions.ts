"use server";

import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { accountIdentity } from "@/modules/rsvp/domain/account-identity";
import { type ZoneRsvpOutcome, zoneRsvpAnchor } from "@/modules/rsvp/domain/zone-outcome";
import { answerRsvp, withdrawRsvp } from "@/modules/rsvp/rsvp";
import { canOpenMembersZone } from "@/modules/staff-identity/domain/roles";
import { getCurrentAccount } from "@/modules/staff-identity/session";
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

/** The zone again, with what happened said once, at the row that was pressed. */
function back(locale: Locale, outcome: ZoneRsvpOutcome, eventId: string): never {
  const anchor = isUuid(eventId) ? `#${zoneRsvpAnchor(eventId)}` : "";
  redirect(`${getPathname({ locale, href: { pathname: "/members-area/runs", query: { vin: outcome } } })}${anchor}`);
}

/** The signed-in account that may open the zone — or the sign-in, or the 404 (the page's own door, asserted again by the verb). */
async function memberOrSignIn(locale: Locale) {
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
      // CONFLICT: not offered (any more). VALIDATION_ERROR: the account's address is not one the service can keep.
      if (!isDomainError(error)) throw error;
    }
  }
  back(locale, outcome, eventId);
}

/** «Nu mai vin»: the account's answer taken back — never gated by the notice or the tick (a person may always take an answer back). */
export async function leaveAsMemberAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const eventId = text(form, "eventId");
  const account = await memberOrSignIn(locale);
  if (isUuid(eventId)) {
    await withdrawRsvp(getDb(), { eventId, identity: accountIdentity(account, locale, false) }, new Date());
  }
  back(locale, "left", eventId);
}
