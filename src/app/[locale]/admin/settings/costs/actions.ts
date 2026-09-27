"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { updateBudgetThresholds } from "@/modules/diagnostics/budget-thresholds";
import { NeonLimitsRefusal, updateNeonLimits } from "@/modules/diagnostics/neon-limits";
import { updateNeonPlan } from "@/modules/diagnostics/neon-plan";
import { updateJobCadence } from "@/modules/jobs/cadence";
import { requireStaffCapability } from "@/modules/staff-identity/session";
import { canManageClubSettings, canManagePlatform } from "@/modules/staff-identity/domain/roles";
import { updateTranslationBudget } from "@/modules/translate/budget";
import { env } from "@/shared/config/env";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";

/*
  «Setări» → «Costuri» (§NNN): the Neon plan, the jobs' interval, the translation allowance, the
  month's budget thresholds and the database's brakes. Moved here, unchanged, from
  `/admin/tasks` → «Costuri» (§479); each lands back on this tab.
*/

/** Which language to land back in: the form carries it, because an action has no request locale. */
function localeOf(form: FormData): Locale {
  const raw = form.get("uiLocale");
  return typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
}

/**
 * "The Neon plan we are on" (`DECISIONS.md` §280's follow-up), from the costs panel. The same
 * gate and the same shape as the Mailgun plan on `/admin/emails` (§100): Administrator at the
 * door, the service asserting the role again and writing the audit row. Lands back on the
 * costs panel, where the figures that follow the plan are. A refusal is the form's returned
 * state, with the plan and the note as chosen (`DECISIONS.md` §315), as the Mailgun plan's is.
 */
export async function updateNeonPlanAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/settings/costs" });

  try {
    const actor = await requireStaffCapability(canManageClubSettings);
    await updateNeonPlan(
      getDb(),
      actor,
      { plan: form.get("plan"), note: typeof form.get("note") === "string" ? form.get("note") : "" },
      new Date(),
    );
  } catch (error) {
    return refused(error, form);
  }
  revalidatePath(path);
  await flashOutcome({ saved: "neonPlan" });
  redirect(`${path}?saved=neonPlan#admin-alert`);
}

/**
 * "Cât de des verifică site-ul" (§334), from the costs panel beside the Neon plan: the minimum
 * minutes between two real runs of each scheduled job. The same shape as the Neon plan, and a
 * higher door since §450 — Superadministrator, a platform setting that can hold every job back —
 * with the service asserting the role again, writing the audit row and forgetting every cached
 * schedule, and a refusal handed back as the form's state (§315).
 *
 * No `revalidatePath` here, unlike its neighbours, on purpose: the service's tag invalidation
 * already refreshes the page this action answers, and a path revalidation would make every
 * schedule the page reads from the cache look missing on it until the next real run.
 */
export async function updateJobCadenceAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/settings/costs" });

  try {
    const actor = await requireStaffCapability(canManagePlatform);
    await updateJobCadence(getDb(), actor, { minutes: form.get("minutes") }, new Date());
  } catch (error) {
    return refused(error, form);
  }
  await flashOutcome({ saved: "jobCadence" });
  redirect(`${path}?saved=jobCadence#admin-alert`);
}

/**
 * «Tradu din română»'s daily allowance of characters (§464), beside the other brakes on what the
 * club pays. A club setting (§450): it caps what the club spends and cannot stop the platform, so
 * the Administrator's door; the service asserts the capability again, refuses a number out of
 * range and writes the audit row; a save that changes nothing writes nothing.
 */
export async function updateTranslationBudgetAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/settings/costs" });

  try {
    const actor = await requireStaffCapability(canManageClubSettings);
    await updateTranslationBudget(getDb(), actor, { dailyCharacters: form.get("dailyCharacters") }, new Date());
  } catch (error) {
    return refused(error, form);
  }
  await flashOutcome({ saved: "translationBudget" });
  redirect(`${path}?saved=translationBudget#admin-alert`);
}

/**
 * The month's budget thresholds (§447), from "Bugetul lunii" on the costs panel: the shares of the
 * Neon quota that turn the governor amber and red. The same door and shape as the interval above —
 * Superadministrator at the door since §450 (a threshold set wrong brakes the platform for nothing
 * or lets the quota suspend the site), the service asserting the role again and writing the audit row — and
 * a refusal handed back as the form's state (§315).
 */
export async function updateBudgetThresholdsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/settings/costs" });

  try {
    const actor = await requireStaffCapability(canManagePlatform);
    await updateBudgetThresholds(getDb(), actor, { amberPercent: form.get("amberPercent"), redPercent: form.get("redPercent") }, new Date());
  } catch (error) {
    return refused(error, form);
  }
  revalidatePath(path);
  await flashOutcome({ saved: "budgetThresholds" });
  redirect(`${path}?saved=budgetThresholds#admin-alert`);
}

/**
 * The database's brakes (§335), from the card beside the Neon plan: the compute's size ceiling
 * and the period's CU-hour limit, written to Neon itself. Superadministrator at the door since
 * §450 (a quota reached suspends the site), the service
 * asserting the role again, reading Neon fresh, checking the rules against that reading, writing,
 * reading back and auditing what Neon then says.
 *
 * A refusal keeps the chosen values in their boxes (§315) and names the reason — the rule the
 * form broke, or what Neon answered (a key that may read and not write, a project busy with
 * another change). The ticked confirmation is the one box that comes back empty: on production it
 * is the guard, and a guard that refills itself is none (`NEVER_KEPT`'s reasoning). The page is
 * revalidated on a refusal too, because a write refused halfway has still changed something, and
 * the readout above the form must say what Neon holds now.
 */
export async function updateNeonLimitsAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const path = getPathname({ locale, href: "/admin/settings/costs" });

  let changed: boolean;
  try {
    const actor = await requireStaffCapability(canManagePlatform);
    const outcome = await updateNeonLimits(
      getDb(),
      actor,
      {
        maxCu: typeof form.get("maxCu") === "string" ? form.get("maxCu") : "",
        // The floor and scale to zero (§479); absent from an older page's form, which keeps both.
        minCu: typeof form.get("minCu") === "string" ? form.get("minCu") : null,
        suspendMode: form.get("suspendMode") === "never" ? "never" : form.get("suspendMode") === "auto" ? "auto" : null,
        quotaMode: form.get("quotaMode") === "limit" ? "limit" : "none",
        quotaCuHours: typeof form.get("quotaCuHours") === "string" ? form.get("quotaCuHours") : null,
        confirmSuspension: form.get("confirmSuspension") === "on",
      },
      { env, now: new Date() },
    );
    changed = outcome.changed;
  } catch (error) {
    const failure = refused(error, form, { never: ["confirmSuspension"] });
    revalidatePath(path);
    return error instanceof NeonLimitsRefusal ? { ...failure, error: error.reason } : failure;
  }
  revalidatePath(path);
  await flashOutcome({ saved: changed ? "neonLimits" : "neonLimitsSame" });
  redirect(`${path}?saved=${changed ? "neonLimits" : "neonLimitsSame"}#admin-alert`);
}
