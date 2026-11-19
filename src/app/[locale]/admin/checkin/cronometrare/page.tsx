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
import { CLUB_TIME_ZONE, formatDay, formatTimeWithSeconds } from "@/i18n/dates";
import { routing } from "@/i18n/routing";
import { findEventTitle } from "@/modules/content/events/repository";
import { typedStartOrNull } from "@/modules/events/domain/provisional-start";
import { raceDayTabs } from "@/modules/race-day/ui/RaceDayTabs";
import { listEventsAcceptingRegistrations, listEventsForDesk } from "@/modules/registrations/admin-repository";
import { eventTakesResults } from "@/modules/results/domain/event-type";
import { RECENT_FINISHERS } from "@/modules/results/domain/finish-line";
import { RESULT_STATUSES } from "@/modules/results/domain/ranking";
import { formatResultTime } from "@/modules/results/domain/result-time";
import { type FinishLineView, readFinishLine } from "@/modules/results/results";
import FinishLine, { type FinishLineWords } from "@/modules/results/ui/FinishLine";
import RaceGunPress from "@/modules/results/ui/RaceGunPress";
import { canEnterResults, canRecordFinishes } from "@/modules/staff-identity/domain/roles";
import { requireStaff } from "@/modules/staff-identity/session";
import { isDomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import GlyphButton from "@/shared/ui/GlyphButton";
import { HEADING_SX } from "@/shared/ui/heading-scale";
import QuietHelp from "@/shared/ui/QuietHelp";
import { readFinishClockAction, recordFinishFormAction, recordFinishPressAction, setRaceGunAction, undoFinishFormAction, undoFinishPressAction } from "./actions";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ eventId?: string; ok?: string; dup?: string; s?: string; t?: string; refused?: string; bib?: string; undone?: string; gun?: string }>;
};

/** Reads the stored rows and is returned to right after every plain press. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** The refusals the page's banner says after a plain form (scripts off), each `Admin.timing.banner.refused.<code>`. */
const BANNER_REFUSALS = [
  "RESULT_BIB_UNKNOWN",
  "RESULT_FINISH_NOT_STARTED",
  "RESULT_FINISH_CLOSED",
  "RESULT_UNDO_NOT_ALLOWED",
  "RACE_GUN_FIXED",
  "RACE_GUN_WINDOW",
  "RESULTS_NOT_OPEN",
  "VALIDATION_ERROR",
  "FORBIDDEN",
  "NOT_FOUND",
] as const;
/** The island's refusals by code, each `Admin.timing.refused.<code>`; any other is `refusedOther`. */
const LINE_REFUSALS = ["RESULT_BIB_UNKNOWN", "RESULT_FINISH_NOT_STARTED", "RESULT_FINISH_CLOSED", "RESULT_PRESS_UNDONE", "RESULTS_NOT_OPEN", "VALIDATION_ERROR", "FORBIDDEN", "NOT_FOUND"] as const;
const UNDO_REFUSALS = ["RESULT_UNDO_NOT_ALLOWED", "NOT_FOUND", "FORBIDDEN"] as const;

const number = (raw: string | undefined) => (raw !== undefined && /^\d{1,9}$/.test(raw) ? Number(raw) : null);

/**
 * «Cronometrare» (§NNN, amending §850; the owner, 2026-11-18, three days before the race: «pentru ziua cursei am nevoie de o pagină
 * nouă pentru cronometrare, practic trebuie să trec data sosirii pentru fiecare alergător, la elite trec doar prenumele, ca așa sunt
 * trecuți, la resturi trec BIB și așa îi identific» — «un view rapid, în care să introduc și să se salveze instant» — «ca s-ar putea
 * să ajungă mulți deodată»): «Ziua cursei»'s finish line, its third tab (`raceDayTabs`), in «Sosire»'s place.
 *
 * The event is the one the address names (`?eventId=`, any race — «Clasament»'s tab and the old «Sosire» send theirs), else the
 * desk's own default, as «Lucruri de adus» picks it; the desk's select changes it. On a race: the gun — «Start» for whoever enters
 * results (`canEnterResults`), pressed at the gun and moved or taken off until the first finisher; without it the editor's «Startul
 * cursei» counts — and the finish line (`FinishLine`, the page's island): the elites' buttons first, the number box, «⏱ Prinde
 * timpul», the presses of this phone and «Ultimii sosiți» with who entered each. With scripts off every form posts and the page comes
 * back here saying what happened (`?ok=`, `?dup=` with `?s=` when the row is a decision of «Clasament», `?refused=`, `?undone=`,
 * `?gun=` — `repeat` for an organizer's own «Start» heard again within ten seconds —: numbers and codes, never a name). A group run
 * says it has no results, and nothing more. The islands get the server's clock as the page was drawn — read last, after every read
 * —, the viewer's staff id, whose presses alone the page sends, and the event's title, which the finish line keeps on the phone.
 *
 * Every staff role that works the desk opens it (`canRecordFinishes`); anybody else meets the 404 an unknown page gets
 * (BR-REQ-060-01), and every action and the service assert again. Nothing on it is public; no chip time is asked here.
 */
export default async function TimingPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const actor = await requireStaff();
  if (!canRecordFinishes(actor.role)) notFound();

  const query = await searchParams;
  const t = await getTranslations("Admin");
  const db = getDb();
  const now = new Date();

  // The desk's own events (§67): today's first, else every event taking entries — and an event the address names that is not among
  // them (a race from «Clasament», the old «Sosire»'s link) all the same, when it exists.
  let events = await listEventsForDesk(db, locale, now);
  if (events.length === 0) events = await listEventsAcceptingRegistrations(db, locale);
  const requested = query.eventId && isUuid(query.eventId) ? query.eventId : undefined;
  const listed = events.find((candidate) => candidate.id === requested);
  let eventId = listed?.id;
  let view: FinishLineView | null = null;
  const read = async (id: string) => {
    try {
      return await readFinishLine(db, actor, id, now, RECENT_FINISHERS);
    } catch (error) {
      if (isDomainError(error) && error.code === "NOT_FOUND") return null;
      throw error;
    }
  };
  if (!listed && requested) {
    view = await read(requested);
    if (view) eventId = requested;
  }
  eventId ??= events[0]?.id;
  if (eventId && !view) view = await read(eventId);
  const unlisted = view && !events.some((candidate) => candidate.id === view.event.id) ? { id: view.event.id, title: await findEventTitle(db, view.event.id, locale), startsAt: view.event.startsAt, timezone: view.event.timezone } : null;
  const options = unlisted ? [unlisted, ...events] : events;
  const eventLabel = (candidate: { id: string; title: string | null; startsAt: Date; timezone: string }) =>
    `${candidate.title ?? candidate.id} · ${typedStartOrNull(candidate) ? formatDay(candidate.startsAt, { locale, timeZone: candidate.timezone, style: "short" }) : t("editor.dateToBeAnnounced")}`;

  const clock = (at: Date) => formatTimeWithSeconds(at, { locale, timeZone: view?.event.timezone || CLUB_TIME_ZONE });
  const time = (ms: number | null) => (ms === null ? "—" : formatResultTime(ms));
  const recentOf = (bib: number) => view?.recent.find((line) => line.bibNumber === bib);
  const who = (bib: number, label: string | null | undefined) => (label ? `${label} (#${bib})` : `#${bib}`);

  // ---- What a plain press says on its way back (scripts off) -----------------------------------------------------
  const banner = (() => {
    const ok = number(query.ok);
    if (ok !== null) {
      const line = recentOf(ok);
      return { severity: "success" as const, text: line ? t("timing.banner.recorded", { who: `${who(ok, line.label)}${line.name ? ` ${line.name}` : ""}`, time: time(line.gunTimeMs) }) : t("timing.banner.recordedShort", { who: `#${ok}` }) };
    }
    const dup = number(query.dup);
    if (dup !== null) {
      const line = recentOf(dup);
      const mine = time(number(query.t));
      // The row a decision of «Clasament» — «Abandon», «Neprezentat», «Descalificat» —, which the press left as it was.
      const decided = RESULT_STATUSES.find((status) => status !== "FINISHED" && status === query.s);
      if (decided) return { severity: "warning" as const, text: t("timing.banner.decided", { who: `#${dup}`, status: t(`results.status.${decided}`), mine }) };
      return {
        severity: "warning" as const,
        text: line
          ? t("timing.banner.duplicate", { who: who(dup, line.label), by: line.by ?? t("timing.accountGone"), time: time(line.gunTimeMs), mine })
          : t("timing.banner.duplicateShort", { who: `#${dup}`, mine }),
      };
    }
    const undone = number(query.undone);
    if (undone !== null) return { severity: "success" as const, text: t("timing.banner.undone", { who: `#${undone}` }) };
    if (query.gun === "set" || query.gun === "cleared" || query.gun === "unchanged" || query.gun === "repeat") {
      const at = view?.gun.pressed ? clock(view.gun.at) : "";
      return { severity: "success" as const, text: t(`timing.banner.gun.${query.gun}`, { time: at }) };
    }
    const code = BANNER_REFUSALS.find((candidate) => candidate === query.refused);
    if (code) {
      const bib = number(query.bib);
      return { severity: "error" as const, text: t(`timing.banner.refused.${code}`, { who: bib === null ? "" : `#${bib}`, time: time(number(query.t)) }) };
    }
    return null;
  })();

  const head = (
    <>
      {await raceDayTabs({ locale, active: "timing", eventId, actor })}
      <Typography variant="h2" sx={HEADING_SX.title} data-testid="timing-title">
        {t("timing.title")}
      </Typography>
      <Box id="admin-alert" tabIndex={-1} sx={{ scrollMarginTop: 16 }}>
        {banner && (
          <Alert severity={banner.severity} data-testid="timing-banner">
            {banner.text}
          </Alert>
        )}
      </Box>
      {options.length > 0 && (
        <Box component="form" method="get">
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
            {/* A native select, as on the desk: it works before hydration, and the form is a GET anyway. */}
            <TextField
              select
              name="eventId"
              label={t("desk.event")}
              defaultValue={eventId}
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
            <GlyphButton icon="search" type="submit" variant="outlined" sx={{ minHeight: 44 }}>
              {t("timing.show")}
            </GlyphButton>
          </Stack>
        </Box>
      )}
    </>
  );

  if (!view) {
    return (
      <Stack spacing={2}>
        {head}
        <Alert severity="warning">{t("desk.noEvents")}</Alert>
      </Stack>
    );
  }
  if (!eventTakesResults(view.event.type)) {
    return (
      <Stack spacing={2}>
        {head}
        <Alert severity="info" data-testid="results-not-race">
          {t("results.notRace")}
        </Alert>
      </Stack>
    );
  }

  // ---- The gun -----------------------------------------------------------------------------------------------------------
  const { gun } = view;
  const mayStart = canEnterResults(actor.role);
  const plannedWords = typedStartOrNull({ startsAt: gun.planned, timezone: view.event.timezone })
    ? formatDay(gun.planned, { locale, timeZone: view.event.timezone || CLUB_TIME_ZONE, style: "short", position: "inline", withTime: true })
    : t("editor.dateToBeAnnounced");
  const gunLine = gun.pressed
    ? t("timing.gun.pressed", { time: clock(gun.at), by: gun.byName ?? t("timing.accountGone") })
    : t("timing.gun.planned", { time: plannedWords });

  const words: FinishLineWords = {
    clock: t.raw("timing.clock") as string,
    notStarted: t("timing.notStarted"),
    elitesTitle: t("timing.elites.title"),
    elitesHelp: t("timing.elites.help"),
    eliteAria: t.raw("timing.elites.aria") as string,
    eliteFinished: t.raw("timing.elites.finished") as string,
    eliteNoNumberLine: t("timing.elites.noNumberLine"),
    eliteNoNumberRegistration: t("timing.elites.noNumberRegistration"),
    boxLabel: t("timing.boxLabel"),
    bibHint: t("timing.bibHint"),
    record: t("timing.record"),
    keep: t("timing.keep.button"),
    keepHelp: t("timing.keep.help"),
    keptTitle: t("timing.keep.kept"),
    keptDrop: t.raw("timing.keep.drop") as string,
    keptAgeSeconds: t.raw("timing.keep.ageSeconds") as string,
    keptAgeMinutes: t.raw("timing.keep.ageMinutes") as string,
    keptStale: { one: t.raw("timing.keep.stale.one") as string, few: t.raw("timing.keep.stale.few") as string, other: t.raw("timing.keep.stale.other") as string },
    keptStaleDone: t("timing.keep.staleDone"),
    entriesTitle: t("timing.entries.title"),
    waiting: t("timing.entries.waiting"),
    saved: t("timing.entries.saved"),
    place: t.raw("timing.place") as string,
    outOfRanking: t("results.outOfRanking"),
    duplicate: t.raw("timing.entries.duplicate") as string,
    decided: t.raw("timing.entries.decided") as string,
    otherAccount: t.raw("timing.entries.otherAccount") as string,
    status: Object.fromEntries(RESULT_STATUSES.map((status) => [status, t(`results.status.${status}`)])),
    refused: Object.fromEntries(LINE_REFUSALS.map((code) => [code, t.raw(`timing.refused.${code}`) as string])),
    refusedOther: t.raw("timing.refused.other") as string,
    accountGone: t("timing.accountGone"),
    offline: t("timing.offline"),
    session: t("timing.session"),
    reload: t("timing.reload"),
    waitingCount: t.raw("timing.entries.waitingCount") as string,
    recentTitle: t("timing.recent.title"),
    recentAside: t.raw("timing.recent.aside") as string,
    recentEmpty: t("timing.recent.empty"),
    enteredBy: t.raw("timing.enteredBy") as string,
    changedBy: t.raw("timing.changedBy") as string,
    undo: t("timing.undo.button"),
    undoAria: t.raw("timing.undo.aria") as string,
    undone: t("timing.undo.done"),
    undoRefused: Object.fromEntries(UNDO_REFUSALS.map((code) => [code, t(`timing.undo.refused.${code}`)])),
    undoRefusedOther: t("timing.undo.refused.other"),
    undoPressedAgain: { other: t("timing.undo.pressedAgain.other"), self: t("timing.undo.pressedAgain.self") },
    elsewhere: { one: t.raw("timing.elsewhere.one") as string, few: t.raw("timing.elsewhere.few") as string, other: t.raw("timing.elsewhere.other") as string },
    elsewhereOpen: t("timing.elsewhereOpen"),
    elsewhereUnnamed: t("timing.elsewhereUnnamed"),
  };
  // The event's title, kept with its line on the phone: another event's page names where presses wait.
  const eventTitle = options.find((candidate) => candidate.id === view.event.id)?.title ?? null;
  // The server's clock for the islands, read after every read above: the page's delivery is the only lag left in it, and the
  // finish line measures that away with its first round trip.
  const drawnAtMs = new Date().getTime();

  return (
    <Stack spacing={2}>
      {head}
      <Typography variant="body2" color="text.secondary">
        {t("timing.intro")}
        <QuietHelp text={t("timing.more")} />
      </Typography>

      {/* The gun: «Start» for whoever enters results, until the first finisher; the sentence for everybody. */}
      <Box sx={{ display: "grid", gap: 1 }} data-testid="race-gun">
        <Typography variant="body2" sx={{ fontWeight: 600 }} data-testid="race-gun-line">
          {gunLine}
        </Typography>
        {mayStart && gun.fixed && (
          <Typography variant="body2" color="text.secondary" data-testid="race-gun-fixed">
            {t("timing.gun.fixed")}
          </Typography>
        )}
        {mayStart && !gun.fixed && !gun.windowOpen && (
          <Typography variant="body2" color="text.secondary" data-testid="race-gun-window">
            {t("timing.gun.window")}
          </Typography>
        )}
        {mayStart && !gun.fixed && gun.windowOpen && (
          <Stack direction="row" sx={{ gap: 1, alignItems: "center", flexWrap: "wrap" }}>
            <RaceGunPress
              action={setRaceGunAction}
              eventId={view.event.id}
              uiLocale={locale}
              serverNowMs={drawnAtMs}
              label={gun.pressed ? t("timing.gun.move") : t("timing.gun.start")}
              pendingLabel={t("timing.gun.sending")}
            />
            {gun.pressed && (
              <Box component="form" action={setRaceGunAction} data-testid="race-gun-clear-form">
                <input type="hidden" name="uiLocale" value={locale} />
                <input type="hidden" name="eventId" value={view.event.id} />
                <input type="hidden" name="intent" value="clear" />
                <ConfirmSubmitButton
                  label={t("timing.gun.clear")}
                  icon="undo"
                  variant="text"
                  size="medium"
                  title={t("timing.gun.clearTitle")}
                  body={t("timing.gun.clearBody", { time: plannedWords })}
                  confirmLabel={t("timing.gun.clear")}
                  cancelLabel={t("confirm.cancel")}
                />
              </Box>
            )}
          </Stack>
        )}
        {mayStart && !gun.fixed && gun.windowOpen && (
          <Typography variant="caption" color="text.secondary">
            {gun.pressed ? t("timing.gun.moveHelp") : t("timing.gun.startHelp")}
          </Typography>
        )}
      </Box>

      {/* Keyed by the event: another race is another line — its own phone storage, its own queue. */}
      <FinishLine
        key={view.event.id}
        eventId={view.event.id}
        eventTitle={eventTitle}
        uiLocale={locale}
        staffId={actor.id}
        initial={{ serverNowMs: drawnAtMs, gunAtMs: gun.at.getTime(), recent: view.recent, elites: view.elites, finished: view.finished, withNumber: view.withNumber }}
        words={words}
        record={recordFinishPressAction}
        undo={undoFinishPressAction}
        clock={readFinishClockAction}
        recordForm={recordFinishFormAction}
        undoForm={undoFinishFormAction}
      />
    </Stack>
  );
}
