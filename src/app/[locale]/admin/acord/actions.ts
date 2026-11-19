"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { readSignatureTrace } from "@/modules/legal-documents/domain/signature-trace";
import { teamAgreementReturnTo } from "@/modules/staff-identity/domain/team-agreement";
import { requireStaffBeforeTeamAgreement } from "@/modules/staff-identity/session";
import { acceptTeamAgreement } from "@/modules/staff-identity/team-agreement";
import { flashOutcome } from "@/shared/feedback/flash";
import { type FormOutcome, refused } from "@/shared/forms/outcome";

function localeOf(form: FormData): Locale {
  return form.get("uiLocale") === "en" ? "en" : "ro";
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * «Accept și intru» on `/admin/acord` (§NNN): the colleague's acceptance of the team's undertaking in force, then back where they
 * were going — `returnTo`, a same-site path only, or the backoffice's first page. The one action a colleague who owes the
 * undertaking may reach (`requireStaffBeforeTeamAgreement`); the service asks the role again and writes nothing for one that is
 * not asked. A refusal — the name, the tick, a version replaced while the page was open — comes back to the form with what was
 * typed still in it (§315).
 */
export async function acceptTeamAgreementAction(_previous: FormOutcome | null, form: FormData): Promise<FormOutcome | null> {
  const locale = localeOf(form);
  const back = teamAgreementReturnTo(field(form, "returnTo")) ?? getPathname({ locale, href: "/admin" });
  let outcome: Awaited<ReturnType<typeof acceptTeamAgreement>>;
  try {
    const actor = await requireStaffBeforeTeamAgreement();
    outcome = await acceptTeamAgreement(
      getDb(),
      actor,
      {
        documentId: field(form, "documentId"),
        fullName: field(form, "fullName"),
        accepted: form.get("accepted") === "on",
        locale,
        trace: readSignatureTrace(await headers()),
      },
      new Date(),
    );
  } catch (error) {
    return refused(error, form);
  }
  if (outcome !== "notRequired") await flashOutcome({ saved: "teamAgreementAccepted" });
  redirect(back);
}
