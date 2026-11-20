import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { formatDay, formatTime } from "@/i18n/dates";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { noFreePlaceValues, type PlacesTaken } from "@/modules/registrations/domain/capacity";
import { declarationAsksMinorToSignByLocale } from "@/modules/legal-documents/repository";
import { findRegistrationByCheckinCode } from "@/modules/registrations/admin-repository";
import { recordCodeScan } from "@/modules/registrations/admin-service";
import { spareStates } from "@/modules/registrations/bibs";
import { isCheckinCode, normalizeCheckinCode } from "@/modules/registrations/checkin-code";
import { listCodeScans } from "@/modules/registrations/code-scans";
import { type CodeScan, EARLIER_SCANS_SHOWN, earlierScans, OPENED_FROM_REGISTRATION, OPENED_IN_THE_OTHER_LANGUAGE } from "@/modules/registrations/domain/code-scans";
import DeskRow from "@/modules/registrations/ui/DeskRow";
import { familyOf } from "@/modules/registrations/family-marker";
import { formatRaceNumber, raceNumberOf } from "@/modules/registrations/domain/race-number";
import { canWorkTheDesk } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { readRaffleLine } from "@/modules/volunteers/raffle-roster";
import { raffleDeskLine } from "@/modules/volunteers/ui/RaffleLines";
import { raffleDeskExclusionAction } from "../raffle-actions";
import { raffleDeskSignUpAction } from "../tombola/actions";

type Props = {
  params: Promise<{ locale: string; code: string }>;
  searchParams: Promise<{ saved?: string; error?: string; from?: string } & Partial<Record<keyof PlacesTaken, string>>>;
};

export const dynamic = "force-dynamic";

/**
 * What a scanned QR opens (BR-REQ-037-08): one runner, and the button that hands them their number. Behind staff sign-in like
 * the rest of the backoffice — a participant who scans their own code lands on the sign-in page, which is the point: the code
 * identifies, it does not authorize. A code nobody has is a sentence with a way back, not a 404, because at a desk the likeliest
 * cause is a mistyped letter.
 *
 * **A scan is recorded (§996; the owner, 2026-11-19: «vreau si tracing pentru voluntarim [voluntari] gen cine a scanat, cine a
 * marcat prezent»).** Opened for a code that names a registration, one `registration.code_scanned` row under the viewer's staff
 * account (`admin-service.ts#recordCodeScan`, one per account and registration within two minutes) — unless the page is coming back
 * from a desk verb (`saved`, `error`), is the page already open switched to the other language (`from=language`, what the language
 * switch lands with), is a router prefetch (`Next-Router-Prefetch`) or is the registration's own «Deschide la masă»
 * (`from=registration`). A write that fails is a warning in the log and the runner is drawn all the same: the desk never waits on
 * the trail. Under the row, «Scanat înainte: QR1 la 08:05, QR3 la 08:07» — the newest three earlier scans of this code, but the
 * one this visit counts as —, so a second pickup is seen at the table. Both read through the desk's own modules
 * (`registrations/code-scans.ts`), never the organizers' «Jurnal».
 */
export default async function ScannedCodePage({ params, searchParams }: Props) {
  const { locale, code: raw } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canWorkTheDesk(actor.role)) notFound();

  const query = await searchParams;
  const { saved, error } = query;
  const t = await getTranslations("Admin");
  const code = normalizeCheckinCode(raw);
  const db = getDb();
  const now = new Date();
  const row = isCheckinCode(code) ? await findRegistrationByCheckinCode(db, code, locale) : undefined;

  // The scan (§996): never for the same visit again — the page back from a verb, or switched to the other language —, a prefetch of
  // the address, or the registration's own link to it.
  const sameVisit = saved !== undefined || error !== undefined || query.from === OPENED_IN_THE_OTHER_LANGUAGE;
  const requestHeaders = await headers();
  const prefetch = requestHeaders.get("next-router-prefetch") !== null || requestHeaders.get("next-router-segment-prefetch") !== null;
  let ownScanId: string | null = null;
  if (row && !sameVisit && !prefetch && query.from !== OPENED_FROM_REGISTRATION) {
    try {
      ownScanId = (await recordCodeScan(db, actor, row, now)).scanId;
    } catch (failure) {
      // The trail is a record, never a gate: the volunteer at the table gets the runner whatever the write said.
      console.warn(`[desk] the scan was not recorded: ${failure instanceof Error ? failure.message : String(failure)}`);
    }
  }

  // Whether a minor's paper carries the minor's signature too (§330), as on the desk's list.
  const minorSigns = row ? await declarationAsksMinorToSignByLocale(db, now, row.eventId) : { ro: false, en: false };
  // The event's next free desk spare (§444), as on the desk's list.
  const spares = row ? await spareStates(db, [row.eventId]) : {};
  // Who came with this runner (§543), as on the desk's list: names only.
  const family = row ? ((await familyOf(db, [row])).get(row.id) ?? []).map((member) => member.name) : [];
  // The raffle (§984): whether the person takes part, for every desk role — and, in the sign-up mode with its gate open, the desk's sign-up;
  // since §NNN, «Scoate de la tombolă» / «Pune înapoi la tombolă», asked first with the person's number.
  const raffle = row ? await readRaffleLine(db, { table: "registration", id: row.id }, now) : null;
  const raceNumber = row ? raceNumberOf(row) : null;
  // «Scanat înainte» (§996): the code's newest scans, one more than the line names, so this visit's own can be left out.
  const earlier = row ? earlierScans(await listCodeScans(db, row.id, EARLIER_SCANS_SHOWN + 1), { ownScanId, sameVisit, viewerId: actor.id }) : [];
  // Each on the event's clock: the hour alone on today's date, the day beside it otherwise (a code opened the day before).
  const scanWords = (scan: CodeScan) => {
    if (!row) return "";
    const zone = { locale, timeZone: row.eventTimezone };
    const who = scan.actorName ?? t("desk.byRemoved");
    const time = formatTime(scan.at, zone);
    const day = (at: Date) => formatDay(at, { ...zone, style: "short", year: false, position: "inline" });
    return day(scan.at) === day(now) ? t("desk.scannedBeforeAt", { who, time }) : t("desk.scannedBeforeOn", { who, time, day: day(scan.at) });
  };

  return (
    <Stack spacing={3}>
      <Typography variant="body2">
        <Link href="/admin/checkin">{t("desk.backToDesk")}</Link>
      </Typography>
      <Typography variant="h2" sx={{ fontSize: "1.25rem" }}>
        {t("desk.scannedTitle")}
      </Typography>
      <div id="admin-alert" tabIndex={-1}>
        {error && <Alert severity="error">{t(`errors.${error}`, noFreePlaceValues(error, query))}</Alert>}
        {saved && <Alert severity="success">{t(`desk.saved.${saved}`)}</Alert>}
      </div>
      {row ? (
        <>
          <Stack component="ul" spacing={1} sx={{ m: 0, p: 0 }}>
            <DeskRow row={row} locale={locale} back="code" showEvent minorSigns={minorSigns} spare={spares[row.eventId]} family={family} role={actor.role}>
              {raffle &&
                (await raffleDeskLine({
                  line: raffle,
                  locale,
                  back: { to: "code", code },
                  registrationId: row.id,
                  name: row.registeredName,
                  number: raceNumber === null ? null : formatRaceNumber(raceNumber, row.raceNumberFormat),
                  action: raffleDeskSignUpAction,
                  exclusionAction: raffleDeskExclusionAction,
                }))}
            </DeskRow>
          </Stack>
          {/* A second pickup, seen at the table (§996): who opened this code before, and when — nothing when nobody did. */}
          {earlier.length > 0 && (
            <Alert severity="info" data-testid="desk-scanned-before">
              {t("desk.scannedBefore", { scans: earlier.map(scanWords).join(", ") })}
            </Alert>
          )}
        </>
      ) : (
        <Alert severity="warning">{t("desk.unknownCode")}</Alert>
      )}
    </Stack>
  );
}
