import { hasLocale } from "next-intl";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { declarationWords, pdfResponse } from "@/modules/registrations/declaration-labels";
import { renderBlankDeclarationPdf } from "@/modules/registrations/signed-declaration";
import { canWorkTheDesk } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";

/**
 * The blank declaration for one event, to print for the desk (`DECISIONS.md` §95): the
 * current approved text with the event filled in and the person's blanks left dotted. Every
 * staff role, because the desk is every staff role's (BR-REQ-037-08); it names nobody.
 *
 * `?for=minor` (§330) is the same form for a minor, who signs it with a parent or guardian: two
 * signature lines and two identity-document lines. Still nobody's name — the desk writes those.
 * Only under a declaration that asks the minor to sign (`renderBlankDeclarationPdf` asks the text):
 * under an older one the parent signs alone, and this prints the one-signature form.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canWorkTheDesk(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await context.params;
  const search = new URL(request.url).searchParams;
  const locale = search.get("locale") ?? routing.defaultLocale;
  if (!hasLocale(routing.locales, locale)) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  const forMinor = search.get("for") === "minor";

  const now = new Date();
  const pdf = await renderBlankDeclarationPdf(getDb(), id, locale, await declarationWords(locale, now), now, { forMinor });
  if (!pdf) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return pdfResponse(pdf, `declaratie-formular-${forMinor ? "minor-" : ""}${id.slice(0, 8)}.pdf`, "attachment");
}
