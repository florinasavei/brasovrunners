"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { groupRunDraftOf } from "@/modules/group-run-declarations/form";
import { signGroupRunDeclaration, type GroupRunSigningOutcome } from "@/modules/group-run-declarations/service";
import { ID_DOCUMENT } from "@/modules/registrations/fields";
import { botCheckIsOn } from "@/modules/registrations/bot-check";
import { clearFormDraft, stashDraftValues } from "@/modules/registrations/form-draft";
import { DECLARATION_ERROR_SUMMARY_ID } from "@/modules/registrations/form-errors";
import { idDocumentFrom } from "@/modules/registrations/id-document-input";
import { TURNSTILE_FIELD, verifyTurnstile } from "@/modules/registrations/turnstile";
import { isDomainError } from "@/shared/errors/domain-error";

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * The group run's self-declaration, signed (§NNN). Always a redirect back to the signing page:
 * `?done=1` when signed (or when a bot's post was ignored, answered the same, §19.4); `?invalid=`
 * with the refused boxes' names, never a value (§14.5), what was typed riding back sealed (§314);
 * `?changed=1` when a newer version took effect between reading and signing (§57); `?limited=1`
 * past the throttle; `?closed=1` when the run no longer takes a signature.
 */
export async function signGroupRunDeclarationAction(form: FormData): Promise<void> {
  const locale: Locale = form.get("locale") === "en" ? "en" : "ro";
  const slug = text(form, "slug");
  const path = getPathname({ locale, href: { pathname: "/events/[slug]/declaration", params: { slug } } });
  const refuse = async (fields: readonly string[]): Promise<never> => {
    await stashDraftValues(groupRunDraftOf(form), path);
    redirect(`${path}?invalid=${fields.join(",")}#${DECLARATION_ERROR_SUMMARY_ID}`);
  };

  // The bot check, when the club has it on (§97, §254): only a token Cloudflare rejected refuses.
  // The visitor's IP goes to Cloudflare with the token and nowhere else (§19.4).
  const remoteIp = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const verdict = (await botCheckIsOn(getDb(), new Date())) ? await verifyTurnstile(text(form, TURNSTILE_FIELD), remoteIp) : "not_configured";
  if (verdict === "failed") await refuse(["captcha"]);

  // The language the declaration is signed in (§97): the kind of document is written in it too.
  const preferred = text(form, "preferredLocale");
  const signingLocale: Locale = preferred === "en" || preferred === "ro" ? preferred : locale;
  const t = await getTranslations({ locale: signingLocale, namespace: "Registrations" });
  // The series as a series (§95): a shape the browser's own pattern already asked for. A series
  // past that check that is not one is posted as missing, which the service names on its box.
  const series = text(form, "idDocument").trim();
  const idDocument = series !== "" && ID_DOCUMENT.test(series) ? idDocumentFrom(form, t, "idDocument") : undefined;

  let outcome: GroupRunSigningOutcome;
  try {
    outcome = await signGroupRunDeclaration(
      getDb(),
      {
        eventId: text(form, "eventId"),
        documentId: text(form, "documentId"),
        contentSha256: text(form, "contentSha256"),
        accepted: form.get("accepted") === "on",
        typedName: text(form, "typedName"),
        idDocument,
        email: text(form, "email"),
        locale: signingLocale,
        honeypot: text(form, "honeypot") || undefined,
        renderedAt: text(form, "renderedAt") || undefined,
      },
      new Date(),
    );
  } catch (error) {
    if (isDomainError(error) && error.code === "VALIDATION_ERROR") return refuse(error.fields);
    if (isDomainError(error) && error.code === "CONFLICT" && error.message.startsWith("DECLARATION_CHANGED")) redirect(`${path}?changed=1`);
    if (isDomainError(error) && error.code === "NOT_FOUND") redirect(`${path}?closed=1`);
    throw error;
  }

  if (outcome.outcome === "limited") {
    await stashDraftValues(groupRunDraftOf(form), path);
    redirect(`${path}?limited=1`);
  }
  await clearFormDraft(path);
  redirect(`${path}?done=1`);
}
