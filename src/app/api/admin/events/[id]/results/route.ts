import { contentDisposition } from "@/shared/http/content-disposition";
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { routing, type Locale } from "@/i18n/routing";
import { dayIn } from "@/modules/registrations/domain/age";
import { buildResultsCsv, resultsCsvFileName } from "@/modules/results/csv";
import { categoryLabelOf } from "@/modules/results/category-words";
import { formatResultTime } from "@/modules/results/domain/result-time";
import { exportEventResults } from "@/modules/results/results";
import { canEnterResults } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/**
 * «Descarcă clasamentul (CSV)» on a race's «Clasament» page (§808): the results of one event, in the sheet's order — the finishers by
 * position, then the others — in the reader's language (`lang`), names as the backoffice sees them, as a UTF-8 file with a BOM.
 *
 * Whoever may enter the results may take the file — `canEnterResults`, the page's own gate, asserted here again (BR-REQ-060-01): the
 * Tehnic role, a Redactor, a volunteer and a member are refused whatever the link. Nothing is written on the server but one audit row:
 * the download is recorded as the registrations' export and the volunteers' are (§322, §754) — who, which event, how many rows, never
 * a name — because a file that leaves the site is the one copy the retention sweep cannot reach. A GET that mutates nothing else.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canEnterResults(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const lang = new URL(request.url).searchParams.get("lang");
  const locale: Locale = (routing.locales as readonly string[]).includes(lang ?? "") ? (lang as Locale) : routing.defaultLocale;

  let data;
  try {
    data = await exportEventResults(getDb(), actor, id, new Date());
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: error.code === "NOT_FOUND" ? 404 : 403 });
    throw error;
  }

  const t = await getTranslations({ locale, namespace: "Admin" });
  const csv = buildResultsCsv(
    {
      position: t("results.csvColumns.position"),
      positionSex: t("results.csvColumns.positionSex"),
      positionCategory: t("results.csvColumns.positionCategory"),
      bib: t("results.csvColumns.bib"),
      name: t("results.csvColumns.name"),
      sex: t("results.csvColumns.sex"),
      category: t("results.csvColumns.category"),
      status: t("results.csvColumns.status"),
      time: t("results.csvColumns.time"),
      chip: t("results.csvColumns.chip"),
      note: t("results.csvColumns.note"),
    },
    data.rows.map((row) => ({
      position: row.positionOverall,
      positionSex: row.positionSex,
      positionCategory: row.positionCategory,
      bib: row.bibNumber,
      name: row.name,
      // The reader's own word for the sex, as the «Categorie» beside it speaks (§787), not the Excel's machine word.
      sex: row.sex === "FEMALE" ? t("registrations.statistics.sexFemale") : row.sex === "MALE" ? t("registrations.statistics.sexMale") : "",
      // The footer's own words (§787): `category` is the template «{sex}, {band}», read raw so its placeholders are filled by the label, not the formatter.
      category: categoryLabelOf(row.categoryKey, (key) => t.raw(`registrations.statistics.${key}`) as string, data.event.resultAgeBands),
      status: t(`results.status.${row.status}`),
      time: formatResultTime(row.gunTimeMs),
      chip: formatResultTime(row.chipTimeMs),
      note: row.note,
    })),
  );

  const day = dayIn(data.event.startsAt, data.event.timezone);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition("attachment", resultsCsvFileName(day), "results"),
      "X-Robots-Tag": "noindex",
      "Cache-Control": "private, no-store",
    },
  });
}
