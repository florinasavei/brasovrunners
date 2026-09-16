"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import type { EditorialStatus } from "@/modules/staff-identity/domain/roles";
import {
  createPage,
  deletePage,
  movePageInNav,
  savePage,
  transitionPage,
} from "@/modules/content/pages/service";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";

/**
 * The page editor's four writes (BR-REQ-050-03).
 *
 * Same shape as the event editor's actions: every outcome is a redirect carrying a
 * language-neutral code, never a thrown error rendered raw, so `AGENTS.md` §14.3 holds — the
 * code becomes a sentence in the page that receives it.
 */

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function outcomeOf(error: unknown): { error: string } {
  return { error: isDomainError(error) ? error.code : "UNKNOWN" };
}

function backTo(path: string, outcome: { error?: string; saved?: string }): never {
  const query = outcome.error ? `?error=${outcome.error}` : `?saved=${outcome.saved ?? "1"}`;
  redirect(`${path}${query}#admin-alert`);
}

/** Both languages, read from the one form the editor renders. */
function readFields(form: FormData) {
  return {
    navOrder: text(form, "navOrder"),
    translations: Object.fromEntries(
      routing.locales.map((locale) => [
        locale,
        {
          slug: text(form, `translations.${locale}.slug`),
          title: text(form, `translations.${locale}.title`),
          body: text(form, `translations.${locale}.body`),
          seoTitle: text(form, `translations.${locale}.seoTitle`),
          seoDescription: text(form, `translations.${locale}.seoDescription`),
        },
      ]),
    ),
  };
}

export async function createPageAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const listPath = getPathname({ locale, href: "/admin/pages" });

  let pageId: string;
  try {
    const actor = await requireStaff();
    const page = await createPage(getDb(), { actor, fields: readFields(form) });
    pageId = page.id;
  } catch (error) {
    backTo(getPathname({ locale, href: "/admin/pages/new" }), outcomeOf(error));
  }

  // Straight to the new page's own editor, the way creating an event does: the next thing an
  // organizer wants is to keep writing, not to look at a list.
  void listPath;
  redirect(
    `${getPathname({ locale, href: { pathname: "/admin/pages/[id]", params: { id: pageId } } })}?saved=created#admin-alert`,
  );
}

export async function savePageAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const pageId = text(form, "pageId");
  const path = getPathname({ locale, href: { pathname: "/admin/pages/[id]", params: { id: pageId } } });

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await savePage(getDb(), {
      actor,
      pageId,
      expectedVersion: Number(text(form, "expectedVersion")),
      fields: readFields(form),
    });
    outcome = { saved: "page" };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  backTo(path, outcome);
}

export async function transitionPageAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const pageId = text(form, "pageId");
  const path = getPathname({ locale, href: { pathname: "/admin/pages/[id]", params: { id: pageId } } });

  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await transitionPage(getDb(), {
      actor,
      pageId,
      expectedVersion: Number(text(form, "expectedVersion")),
      to: text(form, "to") as EditorialStatus,
    });
    outcome = { saved: text(form, "to") };
  } catch (error) {
    outcome = outcomeOf(error);
  }

  backTo(path, outcome);
}

/**
 * Move a page one place up or down the site navigation, from the list (BR-REQ-050-03).
 *
 * It lands back on the list rather than on the page it moved, because the thing being changed
 * is the order — which is only visible as a list — and the organizer is almost never moving one
 * page once.
 */
export async function movePageAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const listPath = getPathname({ locale, href: "/admin/pages" });

  try {
    const actor = await requireStaff();
    await movePageInNav(getDb(), {
      actor,
      pageId: text(form, "pageId"),
      direction: text(form, "direction") === "up" ? "up" : "down",
    });
  } catch (error) {
    backTo(listPath, outcomeOf(error));
  }

  backTo(listPath, { saved: "moved" });
}

export async function deletePageAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("uiLocale"));
  const pageId = text(form, "pageId");

  try {
    const actor = await requireStaff();
    await deletePage(getDb(), { actor, pageId });
  } catch (error) {
    backTo(
      getPathname({ locale, href: { pathname: "/admin/pages/[id]", params: { id: pageId } } }),
      outcomeOf(error),
    );
  }

  // The page it was editing no longer exists, so the list is the only place left to land.
  redirect(`${getPathname({ locale, href: "/admin/pages" })}?saved=deleted#admin-alert`);
}
