"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";
import { flashPublic } from "@/shared/feedback/flash";
import { acceptVolunteerGuardianByLink } from "@/modules/volunteers/guardian";
import { isDomainError } from "@/shared/errors/domain-error";

function toLocale(value: FormDataEntryValue | null): Locale {
  return typeof value === "string" && (routing.locales as readonly string[]).includes(value) ? (value as Locale) : routing.defaultLocale;
}

/**
 * «Îmi dau acordul» (§768): the guardian link page's one POST, and the only write the link leads to (AGENTS.md §12.8:
 * the GET never mutates). The service spends the link in the statement that records the acceptance; the answer comes
 * back to the same address as a word — `accepted`, `invalid` (spent, expired, replaced, cancelled: one answer) or
 * `refused` with the boxes to fill — never a value of the guardian's. The typed name is the acceptance: it travels in
 * the POST and is kept on the row, not in the address.
 */
export async function acceptVolunteerGuardianAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("locale"));
  const token = typeof form.get("token") === "string" ? String(form.get("token")) : "";
  const path = getPathname({ locale, href: { pathname: "/volunteers/guardian/[token]", params: { token } } });
  let outcome: Awaited<ReturnType<typeof acceptVolunteerGuardianByLink>>;
  try {
    outcome = await acceptVolunteerGuardianByLink(
      getDb(),
      token,
      { agreement: form.get("agreement") === "on", typedName: typeof form.get("typedName") === "string" ? String(form.get("typedName")) : "", locale },
      new Date(),
    );
  } catch (error) {
    if (isDomainError(error) && error.code === "VALIDATION_ERROR") {
      const boxes = error.fields.filter((field) => field === "agreement" || field === "typedName");
      redirect(`${path}?refused=${(boxes.length > 0 ? boxes : ["agreement"]).join(",")}`);
    }
    throw error;
  }
  if (outcome.outcome === "accepted") {
    await flashPublic("volunteerGuardianAccepted");
    redirect(`${path}?accepted=1`);
  }
  if (outcome.outcome === "noAgreement") redirect(`${path}?unavailable=1`);
  redirect(`${path}?invalid=1`);
}
