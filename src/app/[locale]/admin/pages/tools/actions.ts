"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { requireStaff } from "@/modules/staff-identity/session";
import { saveShownTools, setToolsPagePublished, TOOLS } from "@/modules/tools/page-settings";
import { isDomainError } from "@/shared/errors/domain-error";
import { flashOutcome } from "@/shared/feedback/flash";
import type { FormOutcome } from "@/shared/forms/outcome";

/**
 * «Unelte» in the backoffice (§926): the page on the site or off it, and the tools it shows. Each verb asserts the role again
 * in the service (BR-REQ-060-01); the screen only offers it.
 */

function toLocale(value: FormDataEntryValue | null): Locale {
  return value === "en" ? "en" : "ro";
}

function screen(form: FormData): string {
  return getPathname({ locale: toLocale(form.get("uiLocale")), href: "/admin/pages/tools" });
}

async function backTo(path: string, outcome: { error?: string; saved?: string }, anchor: string): Promise<never> {
  await flashOutcome(outcome);
  const query = outcome.error ? `?error=${outcome.error}` : `?saved=${outcome.saved ?? "1"}`;
  redirect(`${path}${query}#${outcome.error ? "admin-alert" : anchor}`);
}

/** «Publică pagina» / «Retrage de pe site». */
export async function setToolsPagePublishedAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const wanted = form.get("published") === "true";
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await setToolsPagePublished(getDb(), { actor, published: wanted });
    outcome = { saved: wanted ? "toolsPagePublished" : "toolsPageUnpublished" };
  } catch (error) {
    if (!isDomainError(error)) throw error;
    outcome = { error: error.code };
  }
  return backTo(screen(form), outcome, "tools-page");
}

/** «Pe site» per tool, saved at once: a tick box posts `tool.<key>` = "on" while ticked. */
export async function saveShownToolsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const shown = TOOLS.filter((tool) => form.get(`tool.${tool}`) === "on");
  let outcome: { error?: string; saved?: string };
  try {
    const actor = await requireStaff();
    await saveShownTools(getDb(), { actor, shown });
    outcome = { saved: "toolsShown" };
  } catch (error) {
    if (!isDomainError(error)) throw error;
    outcome = { error: error.code };
  }
  return backTo(screen(form), outcome, "tools-list");
}
