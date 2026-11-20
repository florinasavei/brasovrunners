import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { countForm } from "@/i18n/count-form";
import { formatDay, formatTimeWithSeconds } from "@/i18n/dates";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { typedStartOrNull } from "@/modules/events/domain/provisional-start";
import {
  JOURNAL_KINDS,
  type JournalCounts,
  type JournalKind,
  type JournalLine,
  type JournalWho,
  journalAccountOf,
  journalAccountValue,
  journalKindOf,
  journalWhoValue,
} from "@/modules/race-day/domain/journal";
import { findJournalEvent, readRaceDayJournal } from "@/modules/race-day/journal";
import { raceDayTabs } from "@/modules/race-day/ui/RaceDayTabs";
import { listEventsAcceptingRegistrations, listEventsForDesk } from "@/modules/registrations/admin-repository";
import { canReadRaceDayJournal } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isUuid } from "@/shared/ids";
import GlyphButton from "@/shared/ui/GlyphButton";
import { HEADING_SX } from "@/shared/ui/heading-scale";
import { TAP_TARGET } from "@/shared/ui/tap-target";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ eventId?: string; account?: string; kind?: string }>;
};

/** Reads the trail as it stands at every visit. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** A line of the log: its four parts side by side on a desktop, wrapping into a block on a phone; a thumb's height, a hairline under it. */
const LINE_SX = { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1, minHeight: 44, py: 0.25, borderBottom: 1, borderColor: "divider" } as const;
/** The time, in figures of one width so the lines' times stand in a column. */
const TIME_SX = { fontVariantNumeric: "tabular-nums", color: "text.secondary", minWidth: "8ch" } as const;
/** The name, a link the height of a thumb inside its line. */
const WHOM_LINK_STYLE = { display: "inline-flex", alignItems: "center", minHeight: 44 } as const;

/**
 * «Jurnal» — «Ziua cursei»'s log (§996; the owner, 2026-11-19: «vreau si tracing pentru voluntarim [voluntari] gen cine a scanat, cine a
 * marcat prezent»), its last tab (`raceDayTabs`): for the chosen event, newest first, every code scanned at the desk, every runner
 * marked present — at the desk, or by their own «Am ajuns» — and every check-in taken back, every runner taken off the raffle or put
 * back on it (§1020: «a scos de la tombolă», «a pus înapoi la tombolă» — who decided), every volunteer confirmed for the raffle alone
 * (§1028: «a confirmat pentru tombolă», and for a minor «acordul părintelui: telefonic» after the name), and every volunteer ticked or
 * unticked «Prezent». Each line: the time to the second on the event's clock (the day beside it when it is not the race's), who — the staff
 * account by its name, «participantul» for the person's own press, «cont șters» for an account gone since —, what, and whom: the
 * runner's name and number, a link to the registration, or the volunteer's name, a link to their page.
 *
 * At the top, one line per account: how many scans, check-ins, undos, raffle marks out and back and volunteer ticks it made — a test registration's never
 * counted (§30). A GET form with three native selects — the event (the desk's own list, and an event the address names that is
 * not on it, as «Cronometrare» takes one), the account, the kind —, so it works before hydration on a phone. At most the newest
 * `JOURNAL_LINES_MAX` lines, then «și încă N». A fixed number of queries whatever the rows (`race-day/journal.ts`).
 *
 * The Organizer, the Administrator and the Superadministrator open it (`canReadRaceDayJournal`); every other role meets the 404 an
 * unknown page gets and is drawn no tab (BR-REQ-060-01). Nothing on it changes anything; nothing on it is public.
 */
export default async function RaceDayJournalPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const actor = await requireStaff();
  if (!canReadRaceDayJournal(actor.role)) notFound();

  const query = await searchParams;
  const t = await getTranslations("Admin");
  const db = getDb();
  const now = new Date();

  // The desk's own events (§67): today's first, else every event taking entries — and an event the address names all the same, when
  // it exists (the log is read the day after too, once the race is closed).
  let events = await listEventsForDesk(db, locale, now);
  if (events.length === 0) events = await listEventsAcceptingRegistrations(db, locale);
  const requested = typeof query.eventId === "string" && isUuid(query.eventId) ? await findJournalEvent(db, query.eventId, locale) : null;
  const event = requested ?? (events[0] ? await findJournalEvent(db, events[0].id, locale) : null);
  const options = event && !events.some((candidate) => candidate.id === event.id) ? [event, ...events] : events;
  const eventLabel = (candidate: { id: string; title: string | null; startsAt: Date; timezone: string }) =>
    `${candidate.title ?? candidate.id} · ${typedStartOrNull(candidate) ? formatDay(candidate.startsAt, { locale, timeZone: candidate.timezone, style: "short" }) : t("editor.dateToBeAnnounced")}`;

  const journal = event ? await readRaceDayJournal(db, actor, { event, account: journalAccountOf(query.account), kind: journalKindOf(query.kind), locale }) : null;

  const whoWords = (who: JournalWho) => (who.kind === "staff" ? who.name : who.kind === "participant" ? t("raceDay.journal.who.participant") : t("desk.byRemoved"));
  const accountWords = (who: JournalWho) =>
    who.kind === "staff" ? who.name : who.kind === "participant" ? t("raceDay.journal.accounts.participant") : t("raceDay.journal.accounts.removed");
  // The time to the second on the event's clock; a line of another day than the race's says its day beside it.
  const day = (at: Date) => (event ? formatDay(at, { locale, timeZone: event.timezone, style: "short", year: false, position: "inline" }) : "");
  const when = (at: Date) => {
    if (!event) return "";
    const time = formatTimeWithSeconds(at, { locale, timeZone: event.timezone });
    return day(at) === day(event.startsAt) ? time : t("raceDay.journal.timeOnDay", { time, day: day(at) });
  };
  const whomWords = (line: JournalLine) => {
    const whom = line.whom;
    if (whom.kind === "volunteer") return t("raceDay.journal.whom.volunteer", { name: whom.name });
    if (whom.test) return t("raceDay.journal.whom.test", { name: whom.name });
    return whom.number === null ? whom.name : t("raceDay.journal.whom.numbered", { name: whom.name, number: whom.number });
  };
  const countsWords = (counts: JournalCounts) =>
    (
      [
        ["scanned", counts.scanned],
        ["checkedIn", counts.checkedIn],
        ["undone", counts.undone],
        // §1020: the runners this account took off the raffle, and put back.
        ["raffleOut", counts.raffleOut],
        ["raffleIn", counts.raffleIn],
        // §1028: the volunteers this account confirmed for the raffle alone.
        ["raffleConfirmed", counts.raffleConfirmed],
        ["volunteerTicks", counts.volunteerTicks],
      ] as const
    )
      .filter(([, n]) => n > 0)
      .map(([key, n]) => t(`raceDay.journal.counts.${key}.${countForm(n, locale)}`, { count: n }))
      .join(" · ");

  // The parts' spaces are real ones (a flex row draws none of them): the line reads, and is copied, as one sentence.
  const line = (entry: JournalLine) => (
    <Box component="li" key={entry.id} sx={LINE_SX} data-testid="race-day-journal-line" data-kind={entry.kind}>
      <Box component="span" sx={TIME_SX}>
        {when(entry.at)}
      </Box>{" "}
      <Box component="span" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
        {whoWords(entry.who)}
      </Box>{" "}
      <Box component="span">{t(`raceDay.journal.verbs.${entry.kind}`)}</Box>{" "}
      <Box component="span" sx={{ overflowWrap: "anywhere", minWidth: 0 }}>
        {/* Never prefetched: three hundred names in view would each wake a page nobody opened. */}
        <Link
          href={entry.whom.kind === "volunteer" ? { pathname: "/admin/volunteers/[id]", params: { id: entry.whom.id } } : { pathname: "/admin/registrations/[id]", params: { id: entry.whom.id } }}
          prefetch={false}
          style={WHOM_LINK_STYLE}
          data-testid="race-day-journal-whom"
        >
          {whomWords(entry)}
        </Link>
      </Box>
      {/* A volunteer confirmed for the raffle (§1028): a minor's line says how the parent or guardian agreed. */}
      {entry.raffle?.minor && entry.raffle.guardianWay && (
        <>
          {" "}
          <Box component="span" sx={{ color: "text.secondary", overflowWrap: "anywhere" }} data-testid="race-day-journal-guardian">
            {t("raceDay.journal.guardian", { way: t(`raffle.confirm.ways.${entry.raffle.guardianWay}`) })}
          </Box>
        </>
      )}
    </Box>
  );

  return (
    <Stack spacing={3}>
      {await raceDayTabs({ locale, active: "journal", eventId: event?.id, actor })}
      <Typography variant="h2" sx={HEADING_SX.title} data-testid="race-day-journal-title">
        {t("raceDay.journal.title")}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t("raceDay.journal.intro")} {t("raceDay.journal.ownAccount")}
      </Typography>

      {options.length === 0 || !event || !journal ? (
        <Alert severity="warning">{t("desk.noEvents")}</Alert>
      ) : (
        <>
          <Box component="form" method="get" data-testid="race-day-journal-filters">
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" }, flexWrap: "wrap" }} useFlexGap>
              {/* Native selects, as on the desk: they work before hydration, and the form is a GET anyway. */}
              <TextField
                select
                name="eventId"
                label={t("desk.event")}
                defaultValue={event.id}
                size="small"
                slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                sx={{ minWidth: 240 }}
              >
                {options.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {eventLabel(candidate)}
                  </option>
                ))}
              </TextField>
              <TextField
                select
                name="account"
                label={t("raceDay.journal.account")}
                defaultValue={journalAccountValue(journal.account)}
                size="small"
                slotProps={{ select: { native: true }, inputLabel: { shrink: true }, htmlInput: { "data-testid": "race-day-journal-account" } }}
                sx={{ minWidth: 200 }}
              >
                <option value="">{t("raceDay.journal.accounts.all")}</option>
                {journal.accounts.map((who) => (
                  <option key={journalWhoValue(who)} value={journalWhoValue(who)}>
                    {accountWords(who)}
                  </option>
                ))}
              </TextField>
              <TextField
                select
                name="kind"
                label={t("raceDay.journal.kind")}
                defaultValue={journal.kind ?? ""}
                size="small"
                slotProps={{ select: { native: true }, inputLabel: { shrink: true }, htmlInput: { "data-testid": "race-day-journal-kind" } }}
                sx={{ minWidth: 200 }}
              >
                <option value="">{t("raceDay.journal.kinds.all")}</option>
                {JOURNAL_KINDS.map((kind: JournalKind) => (
                  <option key={kind} value={kind}>
                    {t(`raceDay.journal.kinds.${kind}`)}
                  </option>
                ))}
              </TextField>
              <GlyphButton icon="search" type="submit" variant="outlined" sx={TAP_TARGET}>
                {t("raceDay.journal.show")}
              </GlyphButton>
            </Stack>
          </Box>

          {/* One line per account (§996): what each one did at this event, every kind and every line, the filter aside. */}
          {journal.summary.length > 0 && (
            <Box component="section" aria-labelledby="race-day-journal-summary-title" data-testid="race-day-journal-summary">
              <Typography variant="h3" id="race-day-journal-summary-title" sx={{ ...HEADING_SX[3], mb: 0.5 }}>
                {t("raceDay.journal.summaryTitle")}
              </Typography>
              <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none" }}>
                {journal.summary.map((row) => (
                  <Typography component="li" variant="body2" key={journalWhoValue(row.who)} sx={{ py: 0.25, overflowWrap: "anywhere" }} data-testid="race-day-journal-account-line">
                    <Box component="span" sx={{ fontWeight: 600 }}>
                      {accountWords(row.who)}
                    </Box>
                    {`: ${countsWords(row.counts)}`}
                  </Typography>
                ))}
              </Box>
            </Box>
          )}

          {journal.lines.length === 0 ? (
            <Typography color="text.secondary" data-testid="race-day-journal-empty">
              {journal.account.kind === "all" && journal.kind === null ? t("raceDay.journal.empty") : t("raceDay.journal.emptyFiltered")}
            </Typography>
          ) : (
            <Box component="section" aria-labelledby="race-day-journal-lines-title">
              <Typography variant="h3" id="race-day-journal-lines-title" sx={{ ...HEADING_SX[3], mb: 0.5 }}>
                {t("raceDay.journal.linesTitle")}
              </Typography>
              <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none" }} data-testid="race-day-journal-lines">
                {journal.lines.map(line)}
              </Box>
              {journal.more > 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }} data-testid="race-day-journal-more">
                  {t(`raceDay.journal.more.${countForm(journal.more, locale)}`, { count: journal.more })}
                </Typography>
              )}
            </Box>
          )}
        </>
      )}
    </Stack>
  );
}
