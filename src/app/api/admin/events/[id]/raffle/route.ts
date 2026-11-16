import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { CLUB_TIME_ZONE } from "@/i18n/dates";
import { routing, type Locale } from "@/i18n/routing";
import { requireStaff } from "@/modules/staff-identity/session";
import { buildRaffleCsv, canTakeRaffleList, exportRaffleList, raffleCsvFileName } from "@/modules/volunteers/raffle-list";
import { isDomainError } from "@/shared/errors/domain-error";
import { contentDisposition } from "@/shared/http/content-disposition";
import { isUuid } from "@/shared/ids";

/**
 * «Lista pentru tombolă» on an event's registrations list (§948; the owner, 2026-11-15: «vreau să fac o tombolă și
 * trebuie să pot exporta toți voluntarii și toți participanții»): everybody who wears a number at one event — the
 * confirmed runners and the confirmed volunteers — by the number, as a UTF-8 file with a BOM in the reader's language
 * (`lang`): the number, the name, «Alergător» or «Voluntar» (`modules/volunteers/raffle-list.ts`).
 *
 * Whoever reads the registrations and works the volunteers may take it — the Organizer and the Administrators —
 * asserted here and again by the service (BR-REQ-060-01): the Tehnic role, a Redactor, a volunteer and a member are
 * refused whatever the link. Nothing is written on the server but one audit row, as the other exports write theirs
 * (§322): who, which event and how many of each, never a name. A GET that mutates nothing else.
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
  const lang = new URL(request.url).searchParams.get("lang");
  const locale: Locale = (routing.locales as readonly string[]).includes(lang ?? "") ? (lang as Locale) : routing.defaultLocale;
  const now = new Date();

  let list;
  try {
    list = await exportRaffleList(getDb(), actor, id, now);
  } catch (error) {
    if (isDomainError(error)) return NextResponse.json({ error: error.code }, { status: error.code === "NOT_FOUND" ? 404 : 403 });
    throw error;
  }

  const t = await getTranslations({ locale, namespace: "Admin" });
  const csv = buildRaffleCsv(
    { number: t("registrations.raffle.columns.number"), name: t("registrations.raffle.columns.name"), kind: t("registrations.raffle.columns.kind"), kinds: { RUNNER: t("registrations.raffle.kinds.RUNNER"), VOLUNTEER: t("registrations.raffle.kinds.VOLUNTEER") },
      // «Prezent» (§949): whether the desk checked the runner in — the club filters by it; a volunteer's cell is empty.
      present: t("registrations.raffle.columns.present"),
      presentYes: t("registrations.raffle.present.yes"),
      presentNo: t("registrations.raffle.present.no"),
    },
    list.rows,
  );
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: CLUB_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition("attachment", raffleCsvFileName(day), "raffle"),
      "X-Robots-Tag": "noindex",
      "Cache-Control": "private, no-store",
    },
  });
}
