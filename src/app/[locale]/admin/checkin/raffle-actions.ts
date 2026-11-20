"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { returnedRowOf } from "@/modules/registrations/domain/desk-sections";
import { listReturnAnchor } from "@/modules/registrations/domain/list-row";
import { setRegistrationInRaffleAtDesk } from "@/modules/registrations/raffle-mark";
import { canSetRaffleMarkAtDesk } from "@/modules/staff-identity/domain/roles";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import type { FormOutcome } from "@/shared/forms/outcome";
import { eventIdOf, field, localeOf } from "@/app/[locale]/admin/events/[id]/volunteer-return";

/*
  The desk's raffle line's own press (§1020; the owner, 2026-11-20: «ar trebui să pot să-l scot de la tombolă ca și voluntar dar să
  fie cu extra confirmare și cu logarea în aplicație cu ce voluntar a decis că X nu participă la tombolă»): «Scoate de la tombolă»
  and «Pune înapoi la tombolă», under a row of the desk's list and on the scanned person's view, for every desk role. A file of its
  own beside the desk's page, as a card's verbs live beside theirs: the desk's other verbs are the registrations' (`registrations/
  actions.ts`), the raffle's sign-up at the desk the tab's (`tombola/actions.ts`).

  The form asks first (`ActionForm`'s `confirm`, `RaffleLines.tsx#raffleDeskLine`) — a courtesy: the role is asserted here by the
  press's own predicate and again by the service (BR-REQ-060-01), and a GET never reaches either. It posts the state it wants
  (`inRaffle=1|0`), never a toggle, so a second press — the same phone twice, or a colleague's on another — saves the same and
  writes nothing.
*/

type Outcome = { saved: string } | { error: string };

/**
 * Where the press comes back to, rebuilt from fields and never taken from the form as a path: the desk's list with its event, its
 * search and the row (`back=desk`, as the desk's other presses come back to it, §1002) — landing on the row when it went through,
 * on the alert when it was refused (`listReturnAnchor`) — or else the scanned person's view, at its alert.
 */
function deskAddress(form: FormData, outcome: Outcome): string {
  const locale = localeOf(form);
  const query = new URLSearchParams();
  let path: string;
  let hash = "admin-alert";
  if (field(form, "back") === "desk") {
    path = getPathname({ locale, href: "/admin/checkin" });
    const eventId = eventIdOf(form);
    if (eventId) query.set("eventId", eventId);
    // The desk's search, carried in the address as the desk's own verbs carry it — never into a toast.
    const q = field(form, "q").trim();
    if (q) query.set("q", q.slice(0, 200));
    const row = returnedRowOf(field(form, "registrationId"));
    if (row) query.set("row", row);
    hash = listReturnAnchor("error" in outcome ? { error: outcome.error } : {}, row ?? undefined);
  } else {
    const code = field(form, "code");
    path = getPathname({ locale, href: { pathname: "/admin/checkin/[code]", params: { code: /^[A-Za-z0-9-]{1,32}$/.test(code) ? code : "-" } } });
  }
  if ("saved" in outcome) query.set("saved", outcome.saved);
  else query.set("error", outcome.error);
  return `${path}?${query.toString()}#${hash}`;
}

/**
 * «Scoate de la tombolă» (`inRaffle=0`) / «Pune înapoi la tombolă» (`inRaffle=1`) at the desk (§1020): every desk role, by the
 * press's own predicate (`canSetRaffleMarkAtDesk`) at the door and again in the service, which writes the mark and its one audit
 * row — the staff member and the desk's door (`raffle-mark.ts#setRegistrationInRaffleAtDesk`). It emails nobody and expires no
 * public cache: no public page reads the mark. Back where it was pressed with the desk's sentence (`saved=`) — and, on the
 * desk's list, which lands on the row out of the alert's sight, its toast — or with the refusal's code (`error=`).
 */
export async function raffleDeskExclusionAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const inRaffle = field(form, "inRaffle") === "1";
  let outcome: Outcome;
  try {
    const actor = await requireStaffCapability(canSetRaffleMarkAtDesk);
    const { changed } = await setRegistrationInRaffleAtDesk(getDb(), actor, field(form, "registrationId"), inRaffle, new Date());
    outcome = { saved: changed ? (inRaffle ? "rafflePutBack" : "raffleTakenOut") : "raffleUnchanged" };
  } catch (error) {
    if (!isDomainError(error)) throw error;
    outcome = { error: error.code };
  }
  if ("saved" in outcome && field(form, "back") === "desk") await flashOutcome({ saved: outcome.saved });
  redirect(deskAddress(form, outcome));
}
