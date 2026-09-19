"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { updateEmailPlan } from "@/modules/notifications/email-plan";
import { requireStaffRole } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";

/**
 * "The plan we are on" (`DECISIONS.md` §100). Administrator only — the same gate as "send
 * now", because both spend the club's allowance — and the service asserts the role again.
 * Lands back on `/admin/emails` with the outcome in the query, like every backoffice action.
 */
export async function updateEmailPlanAction(form: FormData): Promise<void> {
  const raw = form.get("uiLocale");
  const locale: Locale = typeof raw === "string" && (routing.locales as readonly string[]).includes(raw) ? (raw as Locale) : routing.defaultLocale;
  const path = getPathname({ locale, href: "/admin/emails" });

  const number = (name: string): number | null => {
    const value = form.get(name);
    if (typeof value !== "string" || value.trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : Number.NaN;
  };

  let outcome: string;
  try {
    const actor = await requireStaffRole("ADMIN");
    await updateEmailPlan(
      getDb(),
      actor,
      {
        plan: form.get("plan"),
        dailyAllowance: number("dailyAllowance"),
        monthlyAllowance: number("monthlyAllowance"),
        note: typeof form.get("note") === "string" ? form.get("note") : "",
      },
      new Date(),
    );
    outcome = "saved=emailPlan";
  } catch (error) {
    if (!isDomainError(error)) throw error;
    outcome = `error=${error.code}`;
  }
  redirect(`${path}?${outcome}#admin-alert`);
}
