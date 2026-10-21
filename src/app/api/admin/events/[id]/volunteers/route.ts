import { contentDisposition } from "@/shared/http/content-disposition";
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { routing, type Locale } from "@/i18n/routing";
import { sexCell } from "@/modules/registrations/domain/sex";
import { shirtSizeShown } from "@/modules/registrations/domain/kit";
import { buildVolunteersCsv, type VolunteerCsvRow, volunteersCsvFileName } from "@/modules/volunteers/csv";
import { buildVolunteersWorkbook, volunteersWorkbookFileName } from "@/modules/volunteers/workbook";
import { isVolunteerMinor, roleLabel, rolesWithCategoryWords } from "@/modules/volunteers/domain/volunteer";
import { exportVolunteers } from "@/modules/volunteers/volunteers";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/**
 * «Descarcă CSV» on an event's «Voluntari» card (§754): the volunteers of one event, grouped by the role given,
 * with the roles each offered for (§761), in the reader's language (`lang`), as a UTF-8 file with a BOM — or, with
 * `format=xlsx` (§839; the owner: «export volunteers in excel as well»), the same rows as a spreadsheet («Descarcă Excel»,
 * on the card and on the «Voluntari» screen), through the writer every backoffice sheet uses.
 *
 * Whoever reads the card may take it — `canManageVolunteers`, the card's own gate, asserted here again
 * (BR-REQ-060-01): the Tehnic role, a Redactor, a volunteer and a member are refused whatever the link.
 * Nothing is written on the server but one audit row: the download is recorded as the registrations'
 * export is (§322) — who, which event and how many rows, never a name or an address — because a file that
 * leaves the site is the one copy the retention sweep cannot reach. A GET that mutates nothing else.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canManageVolunteers(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const url = new URL(request.url);
  const lang = url.searchParams.get("lang");
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const locale: Locale = (routing.locales as readonly string[]).includes(lang ?? "") ? (lang as Locale) : routing.defaultLocale;
  const now = new Date();

  let data;
  try {
    data = await exportVolunteers(getDb(), actor, id, now);
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: error.code === "NOT_FOUND" ? 404 : 403 });
    throw error;
  }

  const t = await getTranslations({ locale, namespace: "Admin" });
  // The roles under their categories in the club's order, each named alone as «Direcționare (Traseu)» (§774); the category's
  // contact person is never in the file.
  const roles = rolesWithCategoryWords(data.categories, data.roles);
  const roleNames = new Map(roles.map((role) => [role.id, roleLabel(role, locale)]));
  const order = new Map(roles.map((role, index) => [role.id, index]));
  // Grouped by the first role given in the club's order — the offers nobody placed yet first (§761) — then oldest first
  // (the list is already oldest first, and the sort is stable).
  const rank = (roleIds: readonly string[]) => (roleIds.length === 0 ? -1 : (order.get(roleIds[0]) ?? 0));
  const volunteers = [...data.volunteers].sort((a, b) => rank(a.roleIds) - rank(b.roleIds));
  const header = {
      role: t("volunteers.csvColumns.role"),
      choices: t("volunteers.csvColumns.choices"),
      name: t("volunteers.csvColumns.name"),
      email: t("volunteers.csvColumns.email"),
      phone: t("volunteers.csvColumns.phone"),
      state: t("volunteers.csvColumns.state"),
      source: t("volunteers.csvColumns.source"),
      message: t("volunteers.csvColumns.message"),
      note: t("volunteers.csvColumns.note"),
      signedUpAt: t("volunteers.csvColumns.signedUpAt"),
      age: t("volunteers.csvColumns.age"),
      dateOfBirth: t("volunteers.csvColumns.dateOfBirth"),
      sex: t("volunteers.csvColumns.sex"),
      city: t("volunteers.csvColumns.city"),
      volunteeredBefore: t("volunteers.csvColumns.volunteeredBefore"),
      clubMember: t("volunteers.csvColumns.clubMember"),
      shirtSize: t("volunteers.csvColumns.shirtSize"),
      guardianName: t("volunteers.csvColumns.guardianName"),
      guardianEmail: t("volunteers.csvColumns.guardianEmail"),
      guardianConsent: t("volunteers.csvColumns.guardianConsent"),
  };
  const rows: VolunteerCsvRow[] = volunteers.map((person) => ({
      // The roles given, joined by «, » like the choices (§837); "" while none.
      role: person.roleIds.flatMap((id) => roleNames.get(id) ?? []).join(", "),
      choices: person.choiceIds.flatMap((id) => roleNames.get(id) ?? []).join(", "),
      name: person.name,
      email: person.email,
      phone: person.phone,
      state: t(`volunteers.states.${person.state}`),
      source: t(`volunteers.sources.${person.source}`),
      message: person.message,
      note: person.note,
      signedUpAt: person.createdAt,
      age: person.age,
      dateOfBirth: person.dateOfBirth,
      sex: sexCell(person.sex),
      city: person.city,
      volunteeredBefore: t(person.volunteeredBefore ? "volunteers.yes" : "volunteers.no"),
      clubMember: t(person.clubMember ? "volunteers.yes" : "volunteers.no"),
      // Only while the event gives T-shirts (§765): a size left from before is exported as nothing.
      shirtSize: shirtSizeShown(data.shirts, person.shirtSize) ?? "",
      // The parent or guardian of a volunteer under eighteen (§768) and whether their consent is in; nothing for an adult.
      guardianName: person.guardianName,
      guardianEmail: person.guardianEmail,
      guardianConsent: isVolunteerMinor(person.age) ? t(person.guardianAcceptedAt ? "volunteers.yes" : "volunteers.no") : "",
  }));

  const day = new Intl.DateTimeFormat("en-CA", { timeZone: CLUB_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  if (format === "xlsx") {
    // The sheet is named «Voluntari» in the reader's language; the file like the CSV's, by the club's date.
    const workbook = await buildVolunteersWorkbook(header, rows, t("volunteers.title"));
    return new NextResponse(new Uint8Array(workbook), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": contentDisposition("attachment", volunteersWorkbookFileName(day), "volunteers"),
        "X-Robots-Tag": "noindex",
        "Cache-Control": "private, no-store",
      },
    });
  }
  const csv = buildVolunteersCsv(header, rows);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition("attachment", volunteersCsvFileName(day), "volunteers"),
      "X-Robots-Tag": "noindex",
      "Cache-Control": "private, no-store",
    },
  });
}
