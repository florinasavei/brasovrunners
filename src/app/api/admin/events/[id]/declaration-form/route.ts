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
  const locale = new URL(request.url).searchParams.get("locale") ?? routing.defaultLocale;
  if (!hasLocale(routing.locales, locale)) return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });

  const now = new Date();
  const pdf = await renderBlankDeclarationPdf(getDb(), id, locale, await declarationWords(locale, now), now);
  if (!pdf) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return pdfResponse(pdf, `declaratie-formular-${id.slice(0, 8)}.pdf`, "attachment");
}
