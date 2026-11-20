import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { routing, type Locale } from "@/i18n/routing";
import { requireStaff } from "@/modules/staff-identity/session";
import { buildRaffleCsv, buildRaffleRandomOrgText, canTakeRaffleList, exportRaffleList, raffleCsvFileName, type RaffleListFormat, raffleRandomOrgFileName } from "@/modules/volunteers/raffle-list";
import { isDomainError } from "@/shared/errors/domain-error";
import { contentDisposition } from "@/shared/http/content-disposition";
import { isUuid } from "@/shared/ids";

/**
 * «Lista pentru tombolă» on an event's registrations list (§948; the owner, 2026-11-15: «vreau să fac o tombolă și
 * trebuie să pot exporta toți voluntarii și toți participanții»): everybody who takes part in the event's raffle, by the
 * number, as a UTF-8 file with a BOM in the reader's language (`lang`): the number as the raffle writes it — a race number as
 * the event writes it, a volunteer's «V007» (§1023) —, the name, the group, and «Prezent» — a runner checked in at the desk or by
 * «Am ajuns» from their own link, a volunteer ticked «Prezent» on the «Voluntari» list (`modules/volunteers/raffle-list.ts`).
 *
 * `?present=1` (§983; the owner, 2026-11-18: «ca să pot face tombola doar pentru cei prezenți») is the second scope,
 * «Lista pentru tombolă — doar prezenții», beside the whole one on the registrations and the «Voluntari» lists: the same
 * four columns for the same people, of whom only those who were there, under a name of its own
 * (`tombola-prezenti-<day>.csv`). Anything else in the address is the whole file.
 *
 * `?format=random-org` (§1023; the owner, 2026-11-20) is «Descarcă pentru random.org», of either scope: the same people, one
 * number per line and nothing else — `text/plain; charset=utf-8`, no BOM, no header, no name, CRLF, no blank line — to paste into
 * random.org's List Randomizer; `tombola-<day>-random-org.txt` / `tombola-prezenti-<day>-random-org.txt`. Anything else in
 * `format` is the CSV.
 *
 * Whoever reads the registrations and works the volunteers may take it — the Organizer and the Administrators —
 * asserted here and again by the service (BR-REQ-060-01): the Tehnic role, a Redactor, a volunteer and a member are
 * refused whatever the link. Nothing is written on the server but one audit row, as the other exports write theirs
 * (§322): who, which event, how many of each group, which of the two scopes was taken (`onlyPresent`), which format
 * (`format`: `csv` or `random-org`) and whether the raffle asked a sign-up (`signUp`), never a name. A GET that mutates nothing else.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  let actor;
  try {
    actor = await requireStaff();
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: 401 });
    throw error;
  }
  if (!canTakeRaffleList(actor.role)) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const search = new URL(request.url).searchParams;
  const lang = search.get("lang");
  const locale: Locale = (routing.locales as readonly string[]).includes(lang ?? "") ? (lang as Locale) : routing.defaultLocale;
  // «doar prezenții» (§983): `present=1` and nothing else asks for the short scope.
  const onlyPresent = search.get("present") === "1";
  // «Descarcă pentru random.org» (§1023): `format=random-org` and nothing else asks for the text file.
  const format: RaffleListFormat = search.get("format") === "random-org" ? "random-org" : "csv";
  const now = new Date();

  let list;
  try {
    list = await exportRaffleList(getDb(), actor, id, now, { onlyPresent, format });
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: error.code === "NOT_FOUND" ? 404 : 403 });
    throw error;
  }

  const day = new Intl.DateTimeFormat("en-CA", { timeZone: CLUB_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const headers = {
    "Content-Disposition": contentDisposition("attachment", (format === "random-org" ? raffleRandomOrgFileName : raffleCsvFileName)(day, { onlyPresent }), "raffle"),
    "X-Robots-Tag": "noindex",
    "Cache-Control": "private, no-store",
  };
  if (format === "random-org") {
    // Numbers alone, in any language: nothing here is a word to translate.
    return new NextResponse(buildRaffleRandomOrgText(list.rows), { headers: { "Content-Type": "text/plain; charset=utf-8", ...headers } });
  }

  const t = await getTranslations({ locale, namespace: "Admin" });
  const csv = buildRaffleCsv(
    // The three groups (§984): «Elită» is a registration marked «Elită» and a line of the race's elite list.
    { number: t("registrations.raffle.columns.number"), name: t("registrations.raffle.columns.name"), kind: t("registrations.raffle.columns.kind"), kinds: { RUNNER: t("registrations.raffle.kinds.RUNNER"), ELITE: t("registrations.raffle.kinds.ELITE"), VOLUNTEER: t("registrations.raffle.kinds.VOLUNTEER") },
      // «Prezent» (§949, §983): whether the person was there — a runner's check-in (the desk's, or «Am ajuns»), the «Voluntari» list's tick for a volunteer.
      present: t("registrations.raffle.columns.present"),
      presentYes: t("registrations.raffle.present.yes"),
      presentNo: t("registrations.raffle.present.no"),
    },
    list.rows,
  );
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", ...headers } });
}
