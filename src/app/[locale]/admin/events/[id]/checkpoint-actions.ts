"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";
import { changeCheckpoints, type CheckpointRequest } from "@/modules/event-checkpoints/checkpoints";
import { CheckpointRefusal, checkpointBox } from "@/modules/event-checkpoints/domain/checkpoint";
import { postedCheckpoints } from "@/modules/event-checkpoints/posted";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";
import { isUuid } from "@/shared/ids";

/*
  An event's checkpoints (§757): the Server Actions behind the editor's «Puncte de control» card.
  Two plain forms that work with scripts off — «Salvează punctele» (the whole list as the card drew
  it) and «Adaugă punctele alese» (what the GPX's preview offered) — and each asks
  `changeCheckpoints`, which asserts the role again (the Organizer and the Administrators write, the
  Tehnic and the Redactor read — BR-REQ-060-01), so the buttons the card draws are a courtesy.
  The card sits beside the editor's save form, never inside it: HTML forms cannot nest, and a
  refusal here must keep what was typed here and nothing of the event's other boxes.
*/

function localeOf(form: FormData): Locale {
  const raw = form.get("uiLocale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** The event the form is about — a malformed id is passed on and the service refuses it (NOT_FOUND). */
function eventIdOf(form: FormData): string {
  const id = field(form, "eventId");
  return isUuid(id) ? id : "";
}

/** Back to the card, with the toast's word in the flash cookie (§384), the card open on arrival. */
async function backToCard(form: FormData, saved: string): Promise<never> {
  const locale = localeOf(form);
  await flashOutcome({ saved });
  const path = getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id: eventIdOf(form) } } });
  revalidatePath(path);
  redirect(`${path}#box-checkpoints`);
}

/** What a refused submit comes back as: the box the rule names, and the rule's own sentence with its names and numbers in the page's language. */
function refusal(error: unknown, form: FormData): FormOutcome {
  const outcome = refused(error, form);
  if (error instanceof CheckpointRefusal) return { ...outcome, error: error.reason, errorValues: error.valuesIn(localeOf(form)) };
  return outcome;
}

async function run(request: CheckpointRequest) {
  const actor = await requireStaff();
  const result = await changeCheckpoints(getDb(), actor, request, new Date());
  // The page's table reads the public cache, and the bib's picture reads the rows: a change expires the cache (§333).
  if (result.changed) revalidatePublicContent("events");
  return result;
}

/** «Salvează punctele»: the list as the card drew it, with the rows added, changed and ticked «Scoate». */
export async function saveCheckpointsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let changed: boolean;
  try {
    changed = (await run({ kind: "save", eventId: eventIdOf(form), rows: postedCheckpoints(form) })).changed;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return refusal(error, form);
  }
  return backToCard(form, changed ? "checkpointsSaved" : "checkpointsUnchanged");
}

/** «Adaugă punctele alese» on the GPX's preview: the ticked proposals, from the file the preview was made from. */
export async function addGpxCheckpointsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let changed: boolean;
  try {
    // Each ticked proposal with the two names the preview's boxes hold for it (`cp[<at>].nameRo`, `cp[<at>].nameEn`).
    const picked = form
      .getAll("pick")
      .filter((value): value is string => typeof value === "string" && /^\d{1,3}$/.test(value))
      .map(Number)
      .map((at) => ({ at, nameRo: field(form, checkpointBox(at, "nameRo")), nameEn: field(form, checkpointBox(at, "nameEn")) }));
    changed = (await run({ kind: "addFromGpx", eventId: eventIdOf(form), gpxKey: field(form, "gpxKey"), picked })).changed;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    return refusal(error, form);
  }
  return backToCard(form, changed ? "checkpointsAdded" : "checkpointsUnchanged");
}
