"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { tokenAttemptAllowed } from "@/modules/action-tokens/throttle";
import { rememberPerson } from "@/modules/person-session/session";
import { confirmRsvp, withdrawRsvp, type RsvpProved } from "@/modules/rsvp/rsvp";
import { RSVP_BOX_ID } from "@/modules/rsvp/rsvp-box";
import { withdrawnProof } from "@/modules/rsvp/withdrawn-proof";

/**
 * The two buttons of a «Vin!» message's page (§NNN, «Vin!» part 1): «Da, vin» and «Nu mai vin». Each spends its link — single
 * use, one statement, one winner (AGENTS.md §12.8) — and each remembers the browser, because a link used from an inbox proves the
 * address as much as the first one did (`person-session/`): the next press on any event that takes answers is one tap. The GET
 * of the page changed nothing; only these do.
 */
function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function pageOf(locale: Locale, token: string): string {
  return getPathname({ locale, href: { pathname: "/vin/[token]", params: { token } } });
}

/** The event's page at the box, in the answer's language — or the listing when the page is gone. */
function eventPageOf(proved: RsvpProved, hash: string): string {
  return proved.slug
    ? `${getPathname({ locale: proved.locale, href: { pathname: "/events/[slug]", params: { slug: proved.slug } } })}${hash}`
    : getPathname({ locale: proved.locale, href: "/events" });
}

async function remember(proved: RsvpProved, now: Date): Promise<void> {
  try {
    await rememberPerson(getDb(), await cookies(), { email: proved.email, displayName: proved.displayName }, now);
  } catch {
    // The answer is counted; a browser that cannot be remembered still types its address next time.
  }
}

/** «Da, vin»: counts the answer, remembers the browser, lands on the event page at the box, which now shows the one-tap state. */
export async function confirmRsvpAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("locale"));
  const token = String(form.get("token") ?? "");
  const db = getDb();
  const now = new Date();
  if (!(await tokenAttemptAllowed(db, token, now))) redirect(`${pageOf(locale, token)}?invalid=1`);
  const proved = await confirmRsvp(db, token, now);
  if (!proved) redirect(`${pageOf(locale, token)}?invalid=1`);
  await remember(proved, now);
  redirect(eventPageOf(proved, `#${RSVP_BOX_ID}`));
}

/** «Nu mai vin»: deletes the answer, remembers the browser, and says so on the same address (the row and its links are gone). */
export async function withdrawRsvpAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("locale"));
  const token = String(form.get("token") ?? "");
  const db = getDb();
  const now = new Date();
  if (!(await tokenAttemptAllowed(db, token, now))) redirect(`${pageOf(locale, token)}?invalid=1`);
  const proved = await withdrawRsvp(db, { token }, now);
  if (!proved) redirect(`${pageOf(locale, token)}?invalid=1`);
  await remember(proved, now);
  // The slug travels as the page's own address, never a value of the person's (§14.5): where the sentence's link goes.
  const slug = proved.slug ?? "";
  redirect(`${pageOf(proved.locale, token)}?retras=${encodeURIComponent(slug)}&ok=${withdrawnProof(token, slug)}`);
}
