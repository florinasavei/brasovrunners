"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { updateNeonPlan } from "@/modules/diagnostics/neon-plan";
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
    /*
      One panel, two switches (§282): the captcha and the hidden trap. The form says which it
      is and the state it wants, so two people pressing at once end up where the second one
      aimed rather than flipping each other's decision.
    */
    const wanted = form.get("enabled") === "1";
    const which = form.get("which") === "honeypot" ? "honeypot" : "enabled";
    await updateBotCheck(getDb(), actor, { [which]: wanted }, new Date());
    outcome = `saved=${which === "honeypot" ? (wanted ? "honeypotOn" : "honeypotOff") : wanted ? "botCheckOn" : "botCheckOff"}`;
  } catch (error) {
    if (!isDomainError(error)) throw error;
    outcome = `error=${error.code}`;
  }
  // The page reads the setting it has just written; without this it comes back saying what it
  // said before the press (the trap §100 and §164 both documented).
  revalidatePath(path);
  redirect(`${path}?${outcome}#admin-alert`);
}

/**
 * "The Neon plan we are on" (`DECISIONS.md` §280's follow-up), from the costs panel. The same
 * gate and the same shape as the Mailgun plan on `/admin/emails` (§100): Administrator at the
 * door, the service asserting the role again and writing the audit row, the outcome in the
 * query. Lands back on the costs panel, where the figures that follow the plan are.
 */
export async function updateNeonPlanAction(form: FormData): Promise<void> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/tasks" });

  let outcome: string;
  try {
    const actor = await requireStaffRole("ADMIN");
    await updateNeonPlan(
      getDb(),
      actor,
      { plan: form.get("plan"), note: typeof form.get("note") === "string" ? form.get("note") : "" },
      new Date(),
    );
    outcome = "saved=neonPlan";
  } catch (error) {
    if (!isDomainError(error)) throw error;
    outcome = `error=${error.code}`;
  }
  revalidatePath(path);
  redirect(`${path}?panel=costs&${outcome}#admin-alert`);
}
