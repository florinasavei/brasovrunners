import type { Locale } from "@/i18n/routing";
import { shirtSizeShown } from "@/modules/registrations/domain/kit";
import { sexCell } from "@/modules/registrations/domain/sex";
import type { VolunteerCsvHeader, VolunteerCsvRow } from "./csv";
import { countsAgainstRole, isVolunteerMinor, roleLabel, rolesWithCategoryWords, standingOf } from "./domain/volunteer";
import type { exportVolunteers } from "./volunteers";
import type { VolunteerSheetWords } from "./workbook";

/** What `exportVolunteers` reads for one event: its roles, categories and people, and whether it gives T-shirts. */
export type VolunteerExportData = Awaited<ReturnType<typeof exportVolunteers>>;

/** The catalogue's `t`, under `Admin`: a key in, the reader's words out. */
type Words = (key: string) => string;

/**
 * One role as «Pe roluri» counts it (§NNN): its category and name in the reader's language, how many it needs, how many were
 * given it and how many of those confirmed, how many more it needs, and how many offered for it — the card's «N din M»
 * (`standingOf`), one line per role, in the club's order.
 */
export type VolunteerRoleSheetRow = {
  category: string;
  role: string;
  /** Null is «fără număr» (§784). */
  needed: number | null;
  taken: number;
  confirmed: number;
  /** Null for a role without a number. */
  free: number | null;
  /** Who ticked the role and is not cancelled — given it or not. */
  offered: number;
};

/** The file's column headings, in the reader's language — the CSV's and the spreadsheet's alike. */
export function volunteerExportHeader(t: Words): VolunteerCsvHeader {
  const column = (key: keyof VolunteerCsvHeader) => t(`volunteers.csvColumns.${key}`);
  return {
    role: column("role"),
    choices: column("choices"),
    name: column("name"),
    email: column("email"),
    phone: column("phone"),
    state: column("state"),
    source: column("source"),
    message: column("message"),
    note: column("note"),
    signedUpAt: column("signedUpAt"),
    age: column("age"),
    dateOfBirth: column("dateOfBirth"),
    sex: column("sex"),
    city: column("city"),
    volunteeredBefore: column("volunteeredBefore"),
    clubMember: column("clubMember"),
    shirtSize: column("shirtSize"),
    guardianName: column("guardianName"),
    guardianEmail: column("guardianEmail"),
    guardianConsent: column("guardianConsent"),
  };
}

/** The spreadsheet's own words (`workbook.ts`) in the reader's language: the sheets, «De repartizat», the states, «Pe roluri». */
export function volunteerSheetWords(t: Words): VolunteerSheetWords {
  const sheet = (key: string) => t(`volunteers.sheet.${key}`);
  return {
    people: sheet("people"),
    roles: sheet("roles"),
    event: sheet("event"),
    unassigned: t("volunteers.unassigned.title"),
    confirmed: t("volunteers.states.CONFIRMED"),
    registered: t("volunteers.states.REGISTERED"),
    cancelled: t("volunteers.states.CANCELLED"),
    category: sheet("category"),
    role: sheet("role"),
    needed: sheet("needed"),
    taken: sheet("taken"),
    confirmedCount: sheet("confirmed"),
    free: sheet("free"),
    offered: sheet("offered"),
    noNumber: sheet("noNumber"),
    total: sheet("total"),
  };
}

/**
 * One event's file, in the reader's language (§754, §761, §839): a row per volunteer, grouped by the first role given in the
 * club's order — the offers nobody placed yet first — then oldest first; and, for the spreadsheet's «Pe roluri», a line per
 * role. The roles name themselves under their categories as «Direcționare (Traseu)» (§774); the category's contact person is
 * never in the file. Shared by the event's download and the «Voluntari» screen's every-event download, so the two never drift.
 */
export function volunteerExport(data: VolunteerExportData, locale: Locale, t: Words): { rows: VolunteerCsvRow[]; roles: VolunteerRoleSheetRow[] } {
  const roles = rolesWithCategoryWords(data.categories, data.roles);
  const roleNames = new Map(roles.map((role) => [role.id, roleLabel(role, locale)]));
  const order = new Map(roles.map((role, index) => [role.id, index]));
  const rank = (roleIds: readonly string[]) => (roleIds.length === 0 ? -1 : (order.get(roleIds[0]) ?? 0));
  // The list is already oldest first, and the sort is stable.
  const volunteers = [...data.volunteers].sort((a, b) => rank(a.roleIds) - rank(b.roleIds));
  const yesNo = (value: boolean) => t(value ? "volunteers.yes" : "volunteers.no");

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
    volunteeredBefore: yesNo(person.volunteeredBefore),
    clubMember: yesNo(person.clubMember),
    // Only while the event gives T-shirts (§765): a size left from before is exported as nothing.
    shirtSize: shirtSizeShown(data.shirts, person.shirtSize) ?? "",
    // The parent or guardian of a volunteer under eighteen (§768) and whether their consent is in; nothing for an adult.
    guardianName: person.guardianName,
    guardianEmail: person.guardianEmail,
    guardianConsent: isVolunteerMinor(person.age) ? yesNo(person.guardianAcceptedAt !== null) : "",
  }));

  // «Alte roluri» names the roles outside every category, but only beside roles that have one (`groupsNeedHeadings`).
  const anyCategory = roles.some((role) => role.categoryRo !== null);
  const roleRows: VolunteerRoleSheetRow[] = roles.map((role) => {
    const standing = standingOf(role, data.volunteers);
    const categoryWords = locale === "en" ? role.categoryEn : role.categoryRo;
    return {
      category: categoryWords ?? (anyCategory ? t("volunteers.otherCategory") : ""),
      role: locale === "en" ? role.nameEn : role.nameRo,
      needed: standing.needed,
      taken: standing.taken,
      confirmed: standing.confirmed,
      free: standing.free,
      offered: data.volunteers.filter((person) => countsAgainstRole(person.state) && person.choiceIds.includes(role.id)).length,
    };
  });
  return { rows, roles: roleRows };
}
