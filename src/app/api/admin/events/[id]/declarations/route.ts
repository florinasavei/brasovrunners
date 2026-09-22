import { hasLocale } from "next-intl";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { declarationWords, pdfResponse } from "@/modules/registrations/declaration-labels";
import { renderEventDeclarationsPdf } from "@/modules/registrations/signed-declaration";
import { canReadRegistrations } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";

/**
 * Every signed declaration of one event in one PDF, oldest first (`DECISIONS.md` §95): what
 * the club downloads after the race and keeps in its own archive. Whoever may read the
 * registrations (§289) — each
 * page names a person and an identity document. `?locale=` chooses the words of the labels;
 * each declaration is in the language it was signed in.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canReadRegistrations(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await context.params;
  const locale = new URL(request.url).searchParams.get("locale") ?? routing.defaultLocale;
  if (!hasLocale(routing.locales, locale)) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });

  const now = new Date();
  const pdf = await renderEventDeclarationsPdf(getDb(), id, locale, await declarationWords(locale, now), now);
  return pdfResponse(pdf, `declaratii-${id.slice(0, 8)}.pdf`, "attachment");
}
