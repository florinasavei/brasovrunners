import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { CLUB_TIME_ZONE, formatDay } from "@/i18n/dates";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { routing } from "@/i18n/routing";
import { isLegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { renderLegalDocumentPdf } from "@/modules/legal-documents/pdf";
import { findVersionWithTranslations } from "@/modules/legal-documents/repository";
import { atLeast } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { CLUB_NAME } from "@/theme/brand";

/**
 * A legal document version, downloaded as a PDF in one language (BR-REQ-053-03).
 *
 * `GET /api/admin/legal/<id>/pdf?locale=ro|en`. Administrator only, like the page it is linked
 * from: a draft is not public until it is approved, and this renders drafts too — labelled.
 * A GET that mutates nothing (AGENTS.md §12.8's rule for links applies to every GET here): it
 * reads the same rows the public page reads and writes the file into the response, nowhere
 * else. Nothing about the download is logged beyond the request itself.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!atLeast(actor.role, "ADMIN")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const locale = new URL(request.url).searchParams.get("locale") ?? routing.defaultLocale;
  if (!hasLocale(routing.locales, locale)) {
    return NextResponse.json({ error: "VALIDATION_ERROR" }, { status: 400 });
  }

  const document = await findVersionWithTranslations(getDb(), id);
  const translation = document?.translations.find((entry) => entry.locale === locale);
  if (!document || !translation || !isLegalDocumentBody(translation.body)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  // The words come from the catalogue in the document's own language, not the reader's: a
  // Romanian declaration downloaded from the English backoffice is still a Romanian document.
  const t = await getTranslations({ locale, namespace: "Admin" });
  const now = new Date();

  const pdf = await renderLegalDocumentPdf({
    version: document.version,
    isApproved: document.isApproved,
    effectiveAt: document.effectiveAt,
    contentSha256: document.contentSha256,
    title: translation.title,
    body: translation.body,
    locale,
    generatedAt: now,
    labels: {
      // The PDF's Author: the platform's one constant (§357, §369), as the declaration and the
      // bib sheet already carry it — never a second copy of the name kept in the catalogue.
      organization: CLUB_NAME,
      version: t("legal.pdf.version", { version: document.version }),
      effectiveFrom: t("legal.pdf.effectiveFrom", {
        date: formatDay(document.effectiveAt, { locale, timeZone: CLUB_TIME_ZONE, style: "long", position: "inline" }),
      }),
      draftNotice: document.isApproved ? "" : t("legal.pdf.draftNotice"),
      generatedOn: t("legal.pdf.generatedOn", { date: formatDay(now, { locale, timeZone: CLUB_TIME_ZONE, style: "long", position: "inline" }) }),
      page: (n, total) => t("legal.pdf.page", { n, total }),
    },
  });

  // ASCII-safe filename: the key is an enum value and the rest are digits and a locale code,
  // so no header-quoting question arises.
  const filename = `${document.key.toLowerCase()}-v${document.version}-${locale}.pdf`;
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}
