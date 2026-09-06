"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import type { LegalDocumentKey } from "@/db/schema/legal-documents";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { textToBody } from "@/modules/legal-documents/domain/body-text";
import {
  approveVersion,
  createDraftVersion,
  updateDraftVersion,
} from "@/modules/legal-documents/service";
import { requireStaffRole } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";

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

function backTo(path: string, outcome: { error?: string; saved?: string }): never {
  const query = new URLSearchParams(
    Object.entries(outcome).filter(([, value]) => value !== undefined) as [string, string][],
  ).toString();
  redirect(query ? `${path}?${query}#admin-alert` : path);
}

function outcomeOf(error: unknown): { error: string } {
  if (isDomainError(error)) return { error: error.code };
  throw error;
}

export async function createLegalVersionAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const key = text(form, "key") as LegalDocumentKey;

  let created: string | undefined;
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaffRole("SUPERADMIN");
    created = await createDraftVersion(getDb(), actor, { key, translations: translationsFrom(form) }, new Date());
    outcome = { saved: "legalDraftCreated" };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  // On success, straight to the new draft: the next thing anybody does is read it before
  // approving, and approval is the one action here that cannot be undone.
  backTo(
    created
      ? getPathname({ locale, href: { pathname: "/admin/legal/[id]", params: { id: created } } })
      : getPathname({ locale, href: "/admin/legal/new" }),
    outcome,
  );
}

export async function updateLegalVersionAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const versionId = text(form, "versionId");

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaffRole("SUPERADMIN");
    await updateDraftVersion(getDb(), actor, versionId, translationsFrom(form), new Date());
    outcome = { saved: "legalDraftSaved" };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  backTo(
    getPathname({ locale, href: { pathname: "/admin/legal/[id]", params: { id: versionId } } }),
    outcome,
  );
}

export async function approveLegalVersionAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const versionId = text(form, "versionId");

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaffRole("SUPERADMIN");
    await approveVersion(getDb(), actor, versionId, new Date());
    outcome = { saved: "legalVersionApproved" };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  backTo(
    getPathname({ locale, href: { pathname: "/admin/legal/[id]", params: { id: versionId } } }),
    outcome,
  );
}
