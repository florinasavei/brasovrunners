"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { faqRowsOf, parseFaqMove } from "@/modules/content/faq/fields";
import { setFaqPagePublished } from "@/modules/content/faq/page-settings";
import { saveFaqPage } from "@/modules/content/faq/service";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";

/**
 * The writes of «Întrebări frecvente» (§NNN): the page's one save (§28) — the introduction and
 * every question card, an arrow on a card being the same save with a move — and the page's
 * publish switch. Every outcome is a redirect to the screen carrying a language-neutral code,
 * except a refused save, which returns so every box comes back as typed (§315). Every one asserts
 * its own role in the service (BR-REQ-060-01).
 */

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** A rich text's JSON as the editor posts it, or absent when the form carried no editor for it. */
function body(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" ? value : undefined;
}

function screen(form: FormData): string {
  return getPathname({ locale: toLocale(form.get("uiLocale")), href: "/admin/pages/faq" });
}

async function backTo(path: string, outcome: { error?: string; saved?: string }, anchor = "admin-alert"): Promise<never> {
  await flashOutcome(outcome);
  const query = outcome.error ? `?error=${outcome.error}` : `?saved=${outcome.saved ?? "1"}`;
  redirect(`${path}${query}#${anchor}`);
}

/** Save the whole page; an arrow pressed on a card (`move` = `"<n>:up"`) moves that card too. */
export async function saveFaqPageAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const move = parseFaqMove(text(form, "move"));
  try {
    const actor = await requireStaff();
    await saveFaqPage(getDb(), {
      actor,
      expectedVersion: Number(text(form, "expectedVersion")),
      fields: { introRoBody: body(form, "introRoBody"), introEnBody: body(form, "introEnBody"), items: faqRowsOf(form) },
      move,
    });
  } catch (error) {
    return refused(error, form);
  }
  return backTo(screen(form), { saved: "faqPageSaved" }, move ? "faq-questions" : "admin-alert");
}

/** Put the page on the site in both languages, or take it off — asks first on the screen (§384). */
export async function setFaqPagePublishedAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const wanted = text(form, "published") === "true";
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await setFaqPagePublished(getDb(), { actor, published: wanted });
    outcome = { saved: wanted ? "faqPagePublished" : "faqPageUnpublished" };
  } catch (error) {
    if (!isDomainError(error)) throw error;
    outcome = { error: error.code };
  }
  return backTo(screen(form), outcome, outcome.error ? "admin-alert" : "faq-page");
}
