"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { changeRaceDayItem, mayReadRaceDayItems, mayWriteRaceDayItems, RACE_DAY_ITEMS_MAX, type RaceDayItemRequest } from "@/modules/race-day/items";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";
import { eventIdOf, field, localeOf } from "@/app/[locale]/admin/events/[id]/volunteer-return";

/*
  The presses of «Lucruri de adus» (§979): add, change, delete, and the tick. Each asks its capability here, by name, at the
  door — the tick whoever works the desk (`mayReadRaceDayItems`), the rest the Organizer and the Administrators
  (`mayWriteRaceDayItems`) — and the service asks it again (BR-REQ-060-01). A press that went through comes back to the list
  with its toast; a refused one-button press comes back to the page's alert with its code in the address; «Adaugă un lucru»
  answers as its form's own state, the box named and what was typed kept (§315). None of them emails anybody.
*/

/** The list's address for one event, at the list (`hash`) or at the page's alert with a refusal's code. */
function listAddress(form: FormData, options: { error?: string; hash?: string } = {}): string {
  const path = getPathname({ locale: localeOf(form), href: "/admin/checkin/lucruri" });
  const query = new URLSearchParams();
  const eventId = eventIdOf(form);
  if (eventId) query.set("eventId", eventId);
  if (options.error) query.set("error", options.error);
  const search = query.toString();
  return `${path}${search ? `?${search}` : ""}#${options.error ? "admin-alert" : (options.hash ?? "race-day-items")}`;
}

/** One one-button press, start to finish: the gate, the service, the toast or the refusal's code, and the way back. */
async function press(form: FormData, capability: typeof mayReadRaceDayItems, request: RaceDayItemRequest, saved: string): Promise<never> {
  let refusal: string | null = null;
  try {
    const actor = await requireStaffCapability(capability);
    const result = await changeRaceDayItem(getDb(), actor, request, new Date());
    await flashOutcome({ saved: result.changed ? saved : "raceDayItemUnchanged" });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    refusal = error.code;
  }
  revalidatePath(getPathname({ locale: localeOf(form), href: "/admin/checkin/lucruri" }));
  // Back at the row pressed — a deleted one is gone, so the list.
  const row = request.kind === "setBrought" || request.kind === "edit" ? `item-${request.id}` : undefined;
  redirect(listAddress(form, refusal ? { error: refusal } : { hash: row }));
}

/** «☐ / ☑» on a row: the state it wants (`brought=1|0`), never a toggle — a double press saves the same. */
export async function setRaceDayItemBroughtAction(form: FormData): Promise<void> {
  const brought = field(form, "brought") === "1";
  await press(form, mayReadRaceDayItems, { kind: "setBrought", eventId: eventIdOf(form), id: field(form, "itemId"), brought }, brought ? "raceDayItemBrought" : "raceDayItemUnbrought");
}

/** «Salvează» in a row's pencil fold: the thing's name and note. */
export async function editRaceDayItemAction(form: FormData): Promise<void> {
  await press(form, mayWriteRaceDayItems, { kind: "edit", eventId: eventIdOf(form), id: field(form, "itemId"), label: field(form, "label"), note: field(form, "note") }, "raceDayItemSaved");
}

/** «Șterge» on a row, asked first on the page with the thing's name. */
export async function removeRaceDayItemAction(form: FormData): Promise<void> {
  await press(form, mayWriteRaceDayItems, { kind: "remove", eventId: eventIdOf(form), id: field(form, "itemId") }, "raceDayItemRemoved");
}

/** «Adaugă un lucru»: appended to the list. A refusal names its box and keeps what was typed. */
export async function addRaceDayItemAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  try {
    const actor = await requireStaffCapability(mayWriteRaceDayItems);
    await changeRaceDayItem(getDb(), actor, { kind: "add", eventId: eventIdOf(form), label: field(form, "label"), note: field(form, "note") }, new Date());
  } catch (error) {
    if (!isDomainError(error)) throw error;
    const outcome = refused(error, form);
    return error.code === "RACE_DAY_ITEMS_FULL" ? { ...outcome, errorValues: { max: String(RACE_DAY_ITEMS_MAX) } } : outcome;
  }
  await flashOutcome({ saved: "raceDayItemAdded" });
  revalidatePath(getPathname({ locale: localeOf(form), href: "/admin/checkin/lucruri" }));
  redirect(listAddress(form, { hash: "race-day-add" }));
}
