"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { setFaqPagePublished } from "@/modules/content/faq/page-settings";
import { createFaqItem, deleteFaqItem, moveFaqItem, saveFaqItem, setFaqItemVisible } from "@/modules/content/faq/service";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";

/**
 * The writes of «Întrebări frecvente» (§NNN), «Echipa»'s shape (§459): every outcome is a redirect
 * to the screen carrying a language-neutral code, except a refused add or save, which returns so
 * every box comes back as typed (§315). Every one asserts its own role in the service
 * (BR-REQ-060-01).
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

function fieldsOf(form: FormData) {
  return {
    questionRo: text(form, "questionRo"),
    questionEn: text(form, "questionEn"),
    answerRoBody: body(form, "answerRoBody"),
    answerEnBody: body(form, "answerEnBody"),
  };
}

function screen(form: FormData): string {
  return getPathname({ locale: toLocale(form.get("uiLocale")), href: "/admin/pages/faq" });
}

async function backTo(path: string, outcome: { error?: string; saved?: string }, anchor = "admin-alert"): Promise<never> {
  await flashOutcome(outcome);
  const query = outcome.error ? `?error=${outcome.error}` : `?saved=${outcome.saved ?? "1"}`;
  redirect(`${path}${query}#${anchor}`);
}

function outcomeOf(error: unknown): { error: string } {
  if (!isDomainError(error)) throw error;
  return { error: error.code };
}

export async function createFaqItemAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let id: string;
  try {
    const actor = await requireStaff();
    const created = await createFaqItem(getDb(), { actor, fields: fieldsOf(form) });
    id = created.id;
  } catch (error) {
    return refused(error, form);
  }
  return backTo(screen(form), { saved: "faqItemCreated" }, `faq-${id}`);
}

export async function saveFaqItemAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const itemId = text(form, "itemId");
  try {
    const actor = await requireStaff();
    await saveFaqItem(getDb(), { actor, itemId, expectedVersion: Number(text(form, "expectedVersion")), fields: fieldsOf(form) });
  } catch (error) {
    return refused(error, form);
  }
  return backTo(screen(form), { saved: "faqItemSaved" }, `faq-${itemId}`);
}

export async function setFaqItemVisibleAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const itemId = text(form, "itemId");
  const wanted = text(form, "visible") === "true";
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await setFaqItemVisible(getDb(), { actor, itemId, expectedVersion: Number(text(form, "expectedVersion")), visible: wanted });
    outcome = { saved: wanted ? "faqItemShown" : "faqItemHidden" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  return backTo(screen(form), outcome, outcome.error ? "admin-alert" : `faq-${itemId}`);
}

/** One place up or down; lands on the question it moved, because the order is read on the list. */
export async function moveFaqItemAction(form: FormData): Promise<void> {
  const itemId = text(form, "itemId");
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await moveFaqItem(getDb(), { actor, itemId, direction: text(form, "direction") === "up" ? "up" : "down" });
    outcome = { saved: "faqItemMoved" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  return backTo(screen(form), outcome, outcome.error ? "admin-alert" : `faq-${itemId}`);
}

export async function deleteFaqItemAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await deleteFaqItem(getDb(), { actor, itemId: text(form, "itemId") });
    outcome = { saved: "faqItemDeleted" };
  } catch (error) {
    outcome = outcomeOf(error);
  }
  return backTo(screen(form), outcome);
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
    outcome = outcomeOf(error);
  }
  return backTo(screen(form), outcome, outcome.error ? "admin-alert" : "faq-page");
}
