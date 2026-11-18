"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { setRegistrationInRaffle } from "@/modules/registrations/raffle-mark";
import { canWorkTheDesk } from "@/modules/staff-identity/domain/roles";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { canTakeRaffleList } from "@/modules/volunteers/raffle-list";
import { deleteRaffleEntry, setEliteLineRaffleTick, signUpForRaffleAtDesk, signUpForRaffleByStaff } from "@/modules/volunteers/raffle-entries";
import type { RafflePersonRef } from "@/modules/volunteers/raffle-roster";
import { changeVolunteer } from "@/modules/volunteers/volunteers";
import { DomainError, isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { isUuid } from "@/shared/ids";
import { eventIdOf, field, localeOf } from "@/app/[locale]/admin/events/[id]/volunteer-return";

/*
  The organizers' presses of «Ziua cursei» → «Tombolă» (§NNN), and the desk's «Înscrie la tombolă». Each asks its capability at the
  door, by name — the tab's the Organizer's and the Administrators' (`canTakeRaffleList`), the desk's every desk role
  (`canWorkTheDesk`) — and the service asks it again (BR-REQ-060-01). A press that went through comes back with its toast; a refused
  one comes back to the page's alert with its code in the address. None of them emails anybody, and no public cache is expired:
  no public page reads a sign-up, an exclusion or a presence.
*/

/** The tab's filters the press keeps: the four the page knows, anything else none. */
const FILTERS = new Set(["in", "out", "present"]);

/** The person a row's form names: its table and its id, or null for anything else a forged form posts. */
function personOf(form: FormData): RafflePersonRef | null {
  const id = field(form, "personId");
  if (!isUuid(id)) return null;
  const table = field(form, "table");
  return table === "registration" || table === "volunteer" || table === "elite" ? { table, id } : null;
}

/** The tab's address for one event, at the row (`hash`) or at the page's alert with a refusal's code. */
function tabAddress(form: FormData, options: { error?: string; hash?: string } = {}): string {
  const path = getPathname({ locale: localeOf(form), href: "/admin/checkin/tombola" });
  const query = new URLSearchParams();
  const eventId = eventIdOf(form);
  if (eventId) query.set("eventId", eventId);
  const filter = field(form, "filter");
  if (FILTERS.has(filter)) query.set("filter", filter);
  if (options.error) query.set("error", options.error);
  return `${path}?${query.toString()}#${options.error ? "admin-alert" : (options.hash ?? "raffle-rows")}`;
}

/** Where a STAFF sign-up comes back to: the tab, or the volunteer's own page it was pressed on. */
function backAddress(form: FormData, person: RafflePersonRef | null, options: { error?: string } = {}): string {
  if (field(form, "back") === "volunteer" && person?.table === "volunteer") {
    const path = getPathname({ locale: localeOf(form), href: { pathname: "/admin/volunteers/[id]", params: { id: person.id } } });
    return options.error ? `${path}?volunteerError=${encodeURIComponent(options.error)}#admin-alert` : `${path}#volunteer-raffle`;
  }
  return tabAddress(form, { error: options.error, hash: person ? `raffle-${person.id}` : undefined });
}

/**
 * «Înscrie la tombolă» by the organizers (STAFF): a person of the event — a registration, a volunteer or a line of the elite list —
 * whose person accepted the rules, the press's own tick (`accepted=on`) saying so.
 */
export async function raffleSignUpAction(form: FormData): Promise<void> {
  const person = personOf(form);
  let refusal: string | null = null;
  try {
    const actor = await requireStaffCapability(canTakeRaffleList);
    if (!person) throw new DomainError("NOT_FOUND", "no such person");
    const outcome = await signUpForRaffleByStaff(getDb(), actor, { person, accepted: form.get("accepted") === "on", eventId: eventIdOf(form) }, new Date());
    await flashOutcome({ saved: outcome === "created" ? "raffleSignedUp" : "raffleAlready" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    refusal = error.code;
  }
  revalidatePath(getPathname({ locale: localeOf(form), href: "/admin/checkin/tombola" }));
  redirect(backAddress(form, person, refusal ? { error: refusal } : {}));
}

/**
 * «Scoate» / «Pune înapoi» on a row: the organizers' exclusion, posting the state it wants (`inRaffle=1|0`), through each kind's own
 * writer — a registration's tick (`raffle-mark.ts#setRegistrationInRaffle`), a volunteer's (`changeVolunteer`'s `setRaffle`) and a
 * line of the elite list's (`setEliteLineRaffleTick`) — each asking its own role again and audited as it always was.
 */
export async function raffleExclusionAction(form: FormData): Promise<void> {
  const person = personOf(form);
  const inRaffle = field(form, "inRaffle") === "1";
  let refusal: string | null = null;
  try {
    const actor = await requireStaffCapability(canTakeRaffleList);
    if (!person) throw new DomainError("NOT_FOUND", "no such person");
    const db = getDb();
    const now = new Date();
    let changed: boolean;
    if (person.table === "registration") {
      // The registration's own tick (§953): its writer asks its own predicate again, and `canTakeRaffleList` implies it.
      changed = (await setRegistrationInRaffle(db, actor, person.id, inRaffle, now)).changed;
    } else if (person.table === "volunteer") {
      // The volunteer's own tick: `changeVolunteer` asks `canManageVolunteers` again, which `canTakeRaffleList` implies.
      changed = (await changeVolunteer(db, actor, { kind: "setRaffle", eventId: eventIdOf(form), id: person.id, inRaffle }, now)).changed;
    } else {
      changed = (await setEliteLineRaffleTick(db, actor, { entryId: person.id, eventId: eventIdOf(form), tick: "inRaffle", on: inRaffle }, now)).changed;
    }
    await flashOutcome({ saved: changed ? (inRaffle ? "rafflePutBack" : "raffleTakenOut") : "raffleUnchanged" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    refusal = error.code;
  }
  revalidatePath(getPathname({ locale: localeOf(form), href: "/admin/checkin/tombola" }));
  redirect(tabAddress(form, refusal ? { error: refusal } : { hash: person ? `raffle-${person.id}` : undefined }));
}

/** «Prezent» on a line of the elite list (`present=1|0`): the organizers' tick — the desk checks no line in. */
export async function raffleElitePresentAction(form: FormData): Promise<void> {
  const entryId = field(form, "personId");
  const present = field(form, "present") === "1";
  let refusal: string | null = null;
  try {
    const actor = await requireStaffCapability(canTakeRaffleList);
    const result = await setEliteLineRaffleTick(getDb(), actor, { entryId, eventId: eventIdOf(form), tick: "present", on: present }, new Date());
    await flashOutcome({ saved: result.changed ? (present ? "rafflePresentOn" : "rafflePresentOff") : "raffleUnchanged" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    refusal = error.code;
  }
  revalidatePath(getPathname({ locale: localeOf(form), href: "/admin/checkin/tombola" }));
  redirect(tabAddress(form, refusal ? { error: refusal } : { hash: `raffle-${entryId}` }));
}

/** «Șterge înscrierea» on a row, asked first on the page with the person's name: the sign-up taken off, audited. */
export async function raffleDeleteEntryAction(form: FormData): Promise<void> {
  let refusal: string | null = null;
  try {
    const actor = await requireStaffCapability(canTakeRaffleList);
    await deleteRaffleEntry(getDb(), actor, { entryId: field(form, "entryId"), eventId: eventIdOf(form) }, new Date());
    await flashOutcome({ saved: "raffleDeleted" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    refusal = error.code;
  }
  revalidatePath(getPathname({ locale: localeOf(form), href: "/admin/checkin/tombola" }));
  const person = personOf(form);
  redirect(tabAddress(form, refusal ? { error: refusal } : { hash: person ? `raffle-${person.id}` : undefined }));
}

/**
 * «Înscrie la tombolă» at the desk (DESK), on the desk's view of a person: every desk role, the person having accepted the rules on
 * paper or aloud (`accepted=on`). Back on the same view, with the desk's own sentence (`saved=`), or its refusal (`error=`).
 */
export async function raffleDeskSignUpAction(form: FormData): Promise<void> {
  const code = field(form, "code");
  const path = getPathname({ locale: localeOf(form), href: { pathname: "/admin/checkin/[code]", params: { code: /^[A-Za-z0-9-]{1,32}$/.test(code) ? code : "-" } } });
  let outcome: "created" | "already";
  try {
    const actor = await requireStaffCapability(canWorkTheDesk);
    outcome = await signUpForRaffleAtDesk(getDb(), actor, { registrationId: field(form, "registrationId"), accepted: form.get("accepted") === "on" }, new Date());
  } catch (error) {
    if (!isDomainError(error)) throw error;
    redirect(`${path}?error=${error.code}#admin-alert`);
  }
  redirect(`${path}?saved=${outcome === "created" ? "raffleSignedUp" : "raffleAlready"}#admin-alert`);
}
