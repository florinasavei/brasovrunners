import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";
import { flashOutcome } from "@/shared/feedback/flash";
import { isUuid } from "@/shared/ids";

/*
  How a volunteer's verb reads its form and where it comes back to (§754, §839): the language of the page, a posted box, the
  event, and the way back — the editor's «Voluntari» card, or the «Voluntari» screen's page the form came from. Shared by the
  card's Server Actions (`volunteer-actions.ts`) and the screen's own (`admin/volunteers/actions.ts`, «Are kit», §904). A plain
  module, never a "use server" file: none of these is a verb a browser may call.
*/

export function localeOf(form: FormData): Locale {
  const raw = form.get("uiLocale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** The event the form is about — a malformed id is passed on and the service refuses it (NOT_FOUND). */
export function eventIdOf(form: FormData): string {
  const id = field(form, "eventId");
  return isUuid(id) ? id : "";
}

/**
 * Where a verb pressed on the «Voluntari» screen comes back to (§839): the list or one person's page, named by the form's
 * `returnTo` — accepted only as a path of that screen, so a forged field can send nobody anywhere else. Null for the card.
 */
const VOLUNTEERS_SCREEN_PATH = /^\/(ro|en)\/admin\/volunteers(\/[0-9a-f-]{36})?(\?[A-Za-z0-9=&%._+-]*)?$/;
function returnToOf(form: FormData): string | null {
  const raw = field(form, "returnTo");
  return VOLUNTEERS_SCREEN_PATH.test(raw) ? raw : null;
}

/**
 * Back to the card, with the toast's word in the flash cookie (§384) or, for a one-button form that has
 * no boxes to keep, the refusal's code in the address for the card's banner — or back to the «Voluntari»
 * screen's page the form came from (§839), the same two ways.
 */
export async function backToCard(form: FormData, outcome: { saved?: string; error?: string; count?: string }): Promise<never> {
  const locale = localeOf(form);
  const id = eventIdOf(form);
  if (outcome.saved) await flashOutcome({ saved: outcome.saved, ...(outcome.count ? { count: outcome.count } : {}) });
  const returnTo = returnToOf(form);
  if (returnTo) {
    const [pathOnly, search = ""] = returnTo.split("?");
    revalidatePath(pathOnly);
    const params = new URLSearchParams(search);
    params.delete("volunteerError");
    if (outcome.error) params.set("volunteerError", outcome.error);
    const query = params.toString();
    redirect(`${pathOnly}${query ? `?${query}` : ""}`);
  }
  const path = getPathname({ locale, href: { pathname: "/admin/events/[id]", params: { id } } });
  revalidatePath(path);
  const query = outcome.error ? `?volunteerError=${encodeURIComponent(outcome.error)}` : "";
  redirect(`${path}${query}#box-volunteers`);
}
