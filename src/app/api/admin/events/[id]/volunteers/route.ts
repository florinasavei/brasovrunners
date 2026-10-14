import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { routing, type Locale } from "@/i18n/routing";
import { sexCell } from "@/modules/registrations/domain/sex";
import { shirtSizeShown } from "@/modules/registrations/domain/kit";
import { buildVolunteersCsv, volunteersCsvFileName } from "@/modules/volunteers/csv";
import { isVolunteerMinor } from "@/modules/volunteers/domain/volunteer";
import { exportVolunteers } from "@/modules/volunteers/volunteers";
import { canManageVolunteers } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";

/**
 * «Descarcă CSV» on an event's «Voluntari» card (§754): the volunteers of one event, grouped by the role given,
 * with the roles each offered for (§761), in the reader's language (`lang`), as a UTF-8 file with a BOM.
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
  const lang = new URL(request.url).searchParams.get("lang");
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
  const roleNames = new Map(data.roles.map((role) => [role.id, locale === "en" ? role.nameEn : role.nameRo]));
  const order = new Map(data.roles.map((role, index) => [role.id, index]));
  // Grouped by the role given in the club's order — the offers nobody placed yet first (§761) — then oldest first
  // (the list is already oldest first, and the sort is stable).
  const rank = (roleId: string | null) => (roleId === null ? -1 : (order.get(roleId) ?? 0));
  const volunteers = [...data.volunteers].sort((a, b) => rank(a.roleId) - rank(b.roleId));
  const csv = buildVolunteersCsv(
    {
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
    },
    volunteers.map((person) => ({
      role: person.roleId === null ? "" : (roleNames.get(person.roleId) ?? ""),
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
    })),
  );

  const day = new Intl.DateTimeFormat("en-CA", { timeZone: CLUB_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${volunteersCsvFileName(day)}"`,
      "X-Robots-Tag": "noindex",
      "Cache-Control": "private, no-store",
    },
  });
}
