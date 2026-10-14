"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";
import { readSignatureTrace } from "@/modules/legal-documents/domain/signature-trace";
import { acceptVolunteerAgreementByLink } from "@/modules/volunteers/agreement";
import { isDomainError } from "@/shared/errors/domain-error";

function toLocale(value: FormDataEntryValue | null): Locale {
  return typeof value === "string" && (routing.locales as readonly string[]).includes(value) ? (value as Locale) : routing.defaultLocale;
}

/**
 * «Accept contractul» (§758): the link page's one POST, and the only write the link leads to (AGENTS.md §12.8:
 * the GET never mutates). The service spends the link in the statement that records the acceptance; the answer
 * comes back to the same address as a word — `accepted`, `invalid` (spent, expired, replaced, cancelled: one
 * answer) or `refused` with the ticks to give — never a value of the person's.
 */
export async function acceptVolunteerAgreementAction(form: FormData): Promise<void> {
  const locale = toLocale(form.get("locale"));
  const token = typeof form.get("token") === "string" ? String(form.get("token")) : "";
  const path = getPathname({ locale, href: { pathname: "/volunteers/agreement/[token]", params: { token } } });
  let outcome: Awaited<ReturnType<typeof acceptVolunteerAgreementByLink>>;
  try {
    outcome = await acceptVolunteerAgreementByLink(
      getDb(),
      token,
      { agreement: form.get("agreement") === "on", adult: form.get("adult") === "on", locale },
      new Date(),
      // The press is the acceptance: its IP address and browser are the signature's trace (§NNN).
      readSignatureTrace(await headers()),
    );
  } catch (error) {
    if (isDomainError(error) && error.code === "VALIDATION_ERROR") {
      const ticks = error.fields.filter((field) => field === "agreement" || field === "adult");
      redirect(`${path}?refused=${(ticks.length > 0 ? ticks : ["agreement"]).join(",")}`);
    }
    throw error;
  }
  if (outcome.outcome === "accepted") redirect(`${path}?accepted=1`);
  if (outcome.outcome === "noAgreement") redirect(`${path}?unavailable=1`);
  redirect(`${path}?invalid=1`);
}
