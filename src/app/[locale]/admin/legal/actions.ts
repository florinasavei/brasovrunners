"use server";

import { redirect } from "next/navigation";
import { flashOutcome } from "@/shared/feedback/flash";
import { getDb } from "@/db/client";
import { clubFactsFromEnv } from "@/modules/legal-documents/templates/club-facts";
import { shownContactAddresses } from "@/modules/contact/shown-address";
import { env } from "@/shared/config/env";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { textToBody } from "@/modules/legal-documents/domain/body-text";
import { confirmationPhrase } from "@/modules/legal-documents/domain/confirmation";
import { LegalBatchVersionRefused } from "@/modules/legal-documents/domain/batch";
import { legalListQuery } from "@/modules/legal-documents/domain/overview";
import {
  approveDrafts,
  approvePlatformTemplates,
  approveVersion,
  createDraftVersion,
  deleteApprovedVersion,
  deleteDraftVersion,
  deleteVersionsInBatch,
  regenerateFromTemplates,
  updateDraftVersion,
  withdrawApprovedVersion,
} from "@/modules/legal-documents/service";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { canWriteLegalTexts } from "@/modules/staff-identity/domain/roles";
import { isDomainError } from "@/shared/errors/domain-error";
import { type FormOutcome, refused } from "@/shared/forms/outcome";

/**
 * Writing the club's legal text from the backoffice (BR-REQ-053-02, `DECISIONS.md` §46).
 *
 * Every one of these goes through `legal-documents/service.ts`, which is where the rule lives:
 * a draft may be rewritten, an approved or referenced version may not, and approval is one-way.
 * These actions parse a form and report an outcome; they decide nothing.
 */

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function translationsFrom(form: FormData) {
  return (["ro", "en"] as const).map((locale) => ({
    locale,
    title: text(form, `${locale}Title`),
    body: textToBody(text(form, `${locale}Body`)),
  }));
}

// `phrase` and `approved` alongside the two outcomes: what an alert needs to say *which* thing
// it is reporting. Never anything about a person — a document code, a number, a count.
async function backTo(
  path: string,
  outcome: { error?: string; saved?: string; phrase?: string; approved?: string; created?: string; deleted?: string },
  /** The page's own filter to land on (§NNN: a regenerate lands on «Ciorne»), before the outcome. */
  landOn: Record<string, string> = {},
): Promise<never> {
  await flashOutcome(outcome);
  const query = new URLSearchParams([
    ...Object.entries(landOn),
    ...(Object.entries(outcome).filter(([, value]) => value !== undefined) as [string, string][]),
  ]).toString();
  redirect(query ? `${path}?${query}#admin-alert` : path);
}

function outcomeOf(error: unknown): { error: string } {
  if (isDomainError(error)) return { error: error.code };
  throw error;
}

/**
 * A new version, as a draft. A refusal — a language left empty — comes back with both texts
 * still in their boxes (`DECISIONS.md` §315): a legal text runs to tens of kilobytes, which is
 * why it is the action's returned state and never a cookie.
 */
export async function createLegalVersionAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const key = text(form, "key") as LegalDocumentKey;

  let created: string;
  try {
    const actor = await requireStaffCapability(canWriteLegalTexts);
    created = await createDraftVersion(getDb(), actor, { key, translations: translationsFrom(form) }, new Date());
  } catch (error) {
    return refused(error, form);
  }

  // On success, straight to the new draft: the next thing anybody does is read it before
  // approving, and approval is the one action here that cannot be undone.
  return backTo(getPathname({ locale, href: { pathname: "/admin/legal/[id]", params: { id: created } } }), { saved: "legalDraftCreated" });
}

export async function updateLegalVersionAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const versionId = text(form, "versionId");

  try {
    const actor = await requireStaffCapability(canWriteLegalTexts);
    await updateDraftVersion(getDb(), actor, versionId, translationsFrom(form), new Date());
  } catch (error) {
    return refused(error, form);
  }

  return backTo(
    getPathname({ locale, href: { pathname: "/admin/legal/[id]", params: { id: versionId } } }),
    { saved: "legalDraftSaved" },
  );
}

/** The three platform texts, with the club's facts, approved in one press (§132). Administrator (§450). */
export async function approvePlatformTemplatesAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));

  let outcome: { error?: string; saved?: string; approved?: string };
  try {
    const actor = await requireStaffCapability(canWriteLegalTexts);
    const db = getDb();
    // The contact address as the club chose to show it (§442).
    const result = await approvePlatformTemplates(db, actor, clubFactsFromEnv(env, await shownContactAddresses(db)), new Date());
    outcome = { saved: "platformApproved", approved: String(result.approved.length) };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  return backTo(getPathname({ locale, href: "/admin/legal" }), outcome);
}

function allOf(form: FormData, name: string): string[] {
  return form.getAll(name).filter((value): value is string => typeof value === "string" && value !== "");
}

/**
 * «Regenerează din șabloane» (§532): a new draft of every text whose platform template says
 * something the text in force and the drafts waiting do not — drafts only, nothing approved. The
 * keys are the ones the confirm dialog named. Administrator (§450), here and in the service.
 */
export async function regenerateLegalTemplatesAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));

  let outcome: { error?: string; saved?: string; created?: string };
  try {
    const actor = await requireStaffCapability(canWriteLegalTexts);
    const db = getDb();
    const result = await regenerateFromTemplates(db, actor, clubFactsFromEnv(env, await shownContactAddresses(db)), allOf(form, "key"), new Date());
    outcome = { saved: "legalTemplatesRegenerated", created: String(result.created.length) };
  } catch (error) {
    outcome = outcomeOf(error);
    // A refusal goes back to the page that was pressed — the list or «Versiune nouă» (§NNN).
    const from = text(form, "returnTo") === "new" ? "/admin/legal/new" : "/admin/legal";
    return backTo(getPathname({ locale, href: from }), outcome);
  }

  // What was made is what to read next: the list, filtered to «Ciorne» (§NNN), from either page —
  // one text's press on its card, «Regenerează toate» on the list or on «Versiune nouă».
  return backTo(getPathname({ locale, href: "/admin/legal" }), outcome, legalListQuery({ state: "drafts", kind: null }));
}

/**
 * «Aprobă toate ciornele» (§532): the drafts the confirm dialog named, approved in one
 * transaction by `approveVersion` — all or none. Administrator (§450), here and in the service.
 */
export async function approveLegalDraftsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));

  let outcome: { error?: string; saved?: string; approved?: string };
  try {
    const actor = await requireStaffCapability(canWriteLegalTexts);
    const approved = await approveDrafts(getDb(), actor, allOf(form, "versionId"), new Date());
    outcome = { saved: "legalDraftsApproved", approved: String(approved) };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  return backTo(getPathname({ locale, href: "/admin/legal" }), outcome);
}

/**
 * The ticked versions deleted in one press, from `/admin/legal/delete` (§532): drafts as one
 * draft is, approved versions as one approved version is — the phrase (`DELETE <n>`) and the
 * reason asked once for all of them, an audit row each. A refusal stays on the batch screen,
 * with the reason back in its box and the phrase to type again, as `deleteApprovedLegalVersionAction`
 * does; the refusals a person can act on are told apart from a race, and a version that became
 * undeletable since the screen was drawn is named by its phrase (`LegalBatchVersionRefused`).
 */
export async function deleteLegalVersionsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));

  let deleted: { drafts: number; approved: number };
  try {
    const actor = await requireStaffCapability(canWriteLegalTexts);
    deleted = await deleteVersionsInBatch(getDb(), actor, {
      versionIds: allOf(form, "versionId"),
      typedConfirmation: text(form, "typedConfirmation"),
      reason: text(form, "reason"),
      now: new Date(),
    });
  } catch (error) {
    const failure = refused(error, form);
    // One version stopped the press: say which, by its phrase (`GDPR 2`), whatever the reason.
    if (error instanceof LegalBatchVersionRefused) {
      return { ...failure, error: "LEGAL_BATCH_VERSION_BLOCKED", errorValues: { version: error.version }, fields: [] };
    }
    const named = (field: string) => isDomainError(error) && error.fields.includes(field);
    return {
      ...failure,
      error: named("typedConfirmation")
        ? "LEGAL_BATCH_CONFIRMATION_MISMATCH"
        : named("reason")
          ? "LEGAL_DELETE_NEEDS_REASON"
          : named("termsAccepted")
            ? "LEGAL_TERMS_ACCEPTED"
            : failure.error,
      fields: failure.fields.filter((field) => field === "typedConfirmation" || field === "reason"),
    };
  }

  return backTo(getPathname({ locale, href: "/admin/legal" }), {
    saved: "legalVersionsDeleted",
    deleted: String(deleted.drafts + deleted.approved),
  });
}

export async function approveLegalVersionAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const versionId = text(form, "versionId");

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaffCapability(canWriteLegalTexts);
    await approveVersion(getDb(), actor, versionId, new Date());
    outcome = { saved: "legalVersionApproved" };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  return backTo(
    getPathname({ locale, href: { pathname: "/admin/legal/[id]", params: { id: versionId } } }),
    outcome,
  );
}

/**
 * Delete a version that was never approved (BR-REQ-053-02, `DECISIONS.md` §53).
 *
 * Always back to the list, never to the version's own page: on success that page describes a
 * row that no longer exists, and a 404 is a poor way to learn a deletion worked. The same
 * reasoning `registrations/actions.ts` gives for erasing a registration.
 */
export async function deleteLegalVersionAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const listPath = getPathname({ locale, href: "/admin/legal" });

  try {
    const actor = await requireStaffCapability(canWriteLegalTexts);
    await deleteDraftVersion(getDb(), actor, text(form, "versionId"));
  } catch (error) {
    return backTo(listPath, outcomeOf(error));
  }

  return backTo(listPath, { saved: "legalVersionDeleted" });
}

/**
 * Withdraw an approved version nothing relied on (BR-REQ-053-02, `DECISIONS.md` §46, §53).
 *
 * The role is asserted twice and that is not belt-and-braces: `requireStaffCapability` answers "is
 * this request from an Administrator", and `assertMayEdit` inside the service answers "may this
 * actor write the club's legal text" — the second is the one that would still be there if this
 * verb were ever called from anywhere but a form (BR-REQ-060-01).
 *
 * Back to the list either way, like deletion: on success the version's own page is still there
 * and still readable, but the thing that changed is which rows the list offers, and that is
 * where somebody wants to be looking.
 */
export async function withdrawLegalVersionAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const listPath = getPathname({ locale, href: "/admin/legal" });

  try {
    const actor = await requireStaffCapability(canWriteLegalTexts);
    await withdrawApprovedVersion(getDb(), actor, text(form, "versionId"), new Date());
  } catch (error) {
    return backTo(listPath, outcomeOf(error));
  }

  return backTo(listPath, { saved: "legalVersionWithdrawn" });
}

/**
 * Delete an approved version outright, number and all (`DECISIONS.md` §151).
 *
 * **Administrator here as well as in the service** (§450; it was the Superadministrator's), and the two are not the same
 * assertion: `requireStaffCapability` answers "is this request from somebody with that role", and
 * `assertMayEdit` inside `deleteApprovedVersion` answers "may this actor write the club's legal
 * text" — the second is the one that would still be there if this verb were ever reached from
 * anywhere but this form (BR-REQ-060-01). It is the same gate `createLegalVersionAction` uses,
 * because the role that writes the club's word is the role that unwrites it.
 *
 * A refusal lands back on the delete screen rather than the list: that screen is where the
 * consequence is written down, and the commonest refusal by far is a mistyped confirmation,
 * which has to be answerable where the phrase is displayed. A mistyped phrase and a missing
 * reason are told apart from every other code, for the same reason erasing a registration tells
 * them apart — "check what you entered" about a field the reader cannot see is not a message.
 *
 * The reason itself never goes into the query string, even on a refusal: it is a free line of
 * somebody's prose, and a query string is the server log, the browser history and the referrer.
 * Since §315 a refusal is the form's returned state rather than a redirect, so the reason comes
 * back in its box without ever leaving the POST; the typed phrase never comes back — it is the
 * guard, and it is meant to be typed again (`NEVER_KEPT`).
 */
export async function deleteApprovedLegalVersionAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = toLocale(form.get("uiLocale"));
  const versionId = text(form, "versionId");

  let deleted: { key: LegalDocumentKey; version: number };
  try {
    const actor = await requireStaffCapability(canWriteLegalTexts);
    deleted = await deleteApprovedVersion(getDb(), actor, {
      versionId,
      typedConfirmation: text(form, "typedConfirmation"),
      reason: text(form, "reason"),
      now: new Date(),
    });
  } catch (error) {
    const failure = refused(error, form);
    const mistyped = isDomainError(error) && error.fields.includes("typedConfirmation");
    const noReason = isDomainError(error) && error.fields.includes("reason");
    /*
      The terms refusal, told apart from a genuine race (§290, §316). Both are `CONFLICT`, and the
      backoffice renders a bare CONFLICT as "somebody else saved meanwhile" — true of a race and
      a lie about this, which is a rule the screen already names before the press. This is what
      is left if the answer changed between the two: a restart that stretched a registration
      across the version's time in force.
    */
    const termsAccepted = isDomainError(error) && error.fields.includes("termsAccepted");
    return {
      ...failure,
      error: mistyped
        ? "LEGAL_CONFIRMATION_MISMATCH"
        : noReason
          ? "LEGAL_DELETE_NEEDS_REASON"
          : termsAccepted
            ? "LEGAL_TERMS_ACCEPTED"
            : failure.error,
      // The two boxes are the only fields this form has; a rule about the version names neither.
      fields: failure.fields.filter((field) => field === "typedConfirmation" || field === "reason"),
    };
  }

  /*
    The list, never the version's own page: that page now describes a row that does not exist,
    and a 404 is a poor way to learn a deletion worked. The phrase goes with it so the alert can
    name what went — it is a document code and a number, which is exactly what the audit row
    keeps and contains nothing about any person.
  */
  return backTo(getPathname({ locale, href: "/admin/legal" }), {
    saved: "legalVersionErased",
    phrase: confirmationPhrase(deleted.key, deleted.version),
  });
}
