"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { updateBotCheck } from "@/modules/registrations/bot-check";
import { requireStaffRole } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";

/** Which language to land back in: the form carries it, because an action has no request locale. */
function localeOf(form: FormData): Locale {
  const raw = form.get("uiLocale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

/**
 * The anti-bot challenge, switched from the task board (`DECISIONS.md` §254).
 *
 * Administrator only — the same gate as every other setting that changes what a participant
 * meets (§100, §164, §244) — and the service asserts the role again and writes the audit row.
 * The panel posts the state it wants rather than a toggle, so two people pressing at once end
 * up where the second one aimed instead of flipping each other's decision.
 */
export async function updateBotCheckAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/tasks" });

  let outcome: string;
  try {
    const actor = await requireStaffRole("ADMIN");
    await updateBotCheck(getDb(), actor, form.get("enabled") === "1", new Date());
    outcome = `saved=${form.get("enabled") === "1" ? "botCheckOn" : "botCheckOff"}`;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    outcome = `error=${error.code}`;
  }
  // The page reads the setting it has just written; without this it comes back saying what it
  // said before the press (the trap §100 and §164 both documented).
  revalidatePath(path);
  redirect(`${path}?${outcome}#admin-alert`);
}
