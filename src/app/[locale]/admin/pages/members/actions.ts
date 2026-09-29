"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { MEMBERS_TEXTS, type MembersText, saveMembersText, setMembersPagePublished } from "@/modules/content/members/page-settings";
import {
  createDiscountCode,
  deleteDiscountCode,
  moveDiscountCode,
  saveDiscountCode,
  setDiscountCodeHidden,
} from "@/modules/content/member-codes/service";
import { canEditMembersPage, canPublishMembersPage } from "@/modules/staff-identity/domain/roles";
import { requireStaff, requireStaffCapability } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";

/**
 * The writes of the members' pages (§524), «Echipa»'s shape (§459): a saved text or a switched page
 * is a redirect to the screen with a language-neutral code; a refused text returns, so every box
 * comes back as typed (§315). Each asks its capability at the door and again in the service
 * (BR-REQ-060-01).
 */

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function screen(form: FormData): string {
  return getPathname({ locale: toLocale(form.get("uiLocale")), href: "/admin/pages/members" });
}

/** Which of the two texts the form carries — a closed set, never a field name taken from the POST. */
function whichText(form: FormData): MembersText {
  const posted = text(form, "text");
  return (MEMBERS_TEXTS as readonly string[]).includes(posted) ? (posted as MembersText) : "benefits";
}

/** One of the two texts, both languages or neither (§352); a refusal returns every box as typed. */
export async function saveMembersTextAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const which = whichText(form);
  try {
    const actor = await requireStaffCapability(canEditMembersPage);
    const fields: Record<string, unknown> = {};
    for (const side of ["RoBody", "EnBody"] as const) {
      const value = form.get(`${which}${side}`);
      if (typeof value === "string") fields[`${which}${side}`] = value;
    }
    await saveMembersText(getDb(), { actor, text: which, fields });
  } catch (error) {
    return refused(error, form);
  }
  await flashOutcome({ saved: "membersTextSaved" });
  redirect(`${screen(form)}?saved=membersTextSaved#members-${which}`);
}

/** Put «Beneficiile membrilor» on the site in both languages, or take it off — asks first on the screen (§384). */
export async function setMembersPagePublishedAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const wanted = text(form, "published") === "true";
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaffCapability(canPublishMembersPage);
    await setMembersPagePublished(getDb(), { actor, published: wanted });
    outcome = { saved: wanted ? "membersPagePublished" : "membersPageUnpublished" };
  } catch (error) {
    if (!isDomainError(error)) throw error;
    outcome = { error: error.code };
  }
  await flashOutcome(outcome);
  const query = outcome.error ? `?error=${outcome.error}` : `?saved=${outcome.saved}`;
  redirect(`${screen(form)}${query}#${outcome.error ? "admin-alert" : "members-page"}`);
}

// --- «Coduri de reducere» (§552) ----------------------------------------------------------------

/**
 * The members' discount codes: a saved or added code returns on a refusal, so every box comes back as
 * typed (§315); every other outcome is a redirect to the card with a language-neutral code and a
 * toast (§384). The door is a staff session; the service asserts each capability again
 * (`canManageDiscountCodes`, `canEditDiscountCodeWords`, BR-REQ-060-01).
 */
function codeFieldsOf(form: FormData) {
  return {
    partnerName: text(form, "partnerName"),
    code: text(form, "code"),
    descriptionRo: text(form, "descriptionRo"),
    descriptionEn: text(form, "descriptionEn"),
    link: text(form, "link"),
    validUntil: text(form, "validUntil"),
  };
}

async function backToCodes(form: FormData, outcome: { error?: string; saved?: string }, anchor = "members-codes"): Promise<never> {
  await flashOutcome(outcome);
  const query = outcome.error ? `?error=${outcome.error}` : `?saved=${outcome.saved ?? "1"}`;
  redirect(`${screen(form)}${query}#${outcome.error ? "admin-alert" : anchor}`);
}

function codeOutcomeOf(error: unknown): { error: string } {
  if (!isDomainError(error)) throw error;
  return { error: error.code };
}

export async function createDiscountCodeAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let id: string;
  try {
    const actor = await requireStaff();
    id = (await createDiscountCode(getDb(), { actor, fields: codeFieldsOf(form) })).id;
  } catch (error) {
    return refused(error, form);
  }
  return backToCodes(form, { saved: "memberCodeCreated" }, `code-${id}`);
}

export async function saveDiscountCodeAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const codeId = text(form, "codeId");
  try {
    const actor = await requireStaff();
    await saveDiscountCode(getDb(), { actor, codeId, expectedVersion: Number(text(form, "expectedVersion")), fields: codeFieldsOf(form) });
  } catch (error) {
    return refused(error, form);
  }
  return backToCodes(form, { saved: "memberCodeSaved" }, `code-${codeId}`);
}

export async function setDiscountCodeHiddenAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const codeId = text(form, "codeId");
  const wanted = text(form, "hidden") === "true";
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await setDiscountCodeHidden(getDb(), { actor, codeId, expectedVersion: Number(text(form, "expectedVersion")), hidden: wanted });
    outcome = { saved: wanted ? "memberCodeHidden" : "memberCodeShown" };
  } catch (error) {
    outcome = codeOutcomeOf(error);
  }
  return backToCodes(form, outcome, `code-${codeId}`);
}

/** One place up or down; lands on the code it moved. A plain form: moving asks nothing first. */
export async function moveDiscountCodeAction(form: FormData): Promise<void> {
  const codeId = text(form, "codeId");
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await moveDiscountCode(getDb(), { actor, codeId, direction: text(form, "direction") === "up" ? "up" : "down" });
    outcome = { saved: "memberCodeMoved" };
  } catch (error) {
    outcome = codeOutcomeOf(error);
  }
  return backToCodes(form, outcome, `code-${codeId}`);
}

export async function deleteDiscountCodeAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await deleteDiscountCode(getDb(), { actor, codeId: text(form, "codeId") });
    outcome = { saved: "memberCodeDeleted" };
  } catch (error) {
    outcome = codeOutcomeOf(error);
  }
  return backToCodes(form, outcome);
}
